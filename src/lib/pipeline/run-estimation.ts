/**
 * Shared estimation pipeline — single source of truth.
 *
 * Called by:
 *   1. /api/estimate-process (Vercel, USE_QUEUE=false)
 *   2. Railway worker (USE_QUEUE=true, no timeout)
 *
 * Extracted from the original estimate-process route so both execution
 * paths share identical logic.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildQQPUserPrompt,
  buildScoringGuides,
  parseClaudeJson,
  STRICT_JSON_RETRY_MESSAGE,
} from "@/lib/ai/prompts";
import { renderPdfPagesToImages, type RenderedImage } from "@/lib/pdf/render-plans";
import { getFloorPlanPages } from "@/lib/pdf/classify-pages-local";
import { splitPdfPages } from "@/lib/pdf/split-pages";
import { logApiCall } from "@/lib/ai/log-api-call";
import {
  categorizeAreas,
  getTotalGrossSqm,
  getBuildingType,
  getUnitCount,
} from "@/lib/cost/area-categories";
import { calculateCost, type PricingConfig } from "@/lib/cost/calculate-cost";
import { getRegionalCoefficient } from "@/lib/cost/regional-coefficients";
import { getPromptSettings } from "@/lib/ai/prompt-settings";
import {
  flattenQQPScores,
  predictF,
  type StoredModel,
} from "@/lib/qqp/model-prediction";
import { QQP_NAMES, QQP_REFERENCE_RANGES } from "@/lib/qqp/reference-ranges";

// ── Types ────────────────────────────────────────────────────────────────────

export type PipelineOptions = {
  /** Max image width in pixels (default: 5000) */
  maxWidth?: number;
  /** Render DPI (default: 300) */
  dpi?: number;
  /** Max floor plan pages to send (default: 12) */
  maxPages?: number;
  /** Extended thinking budget in tokens (default: 10000) */
  thinkingBudget?: number;
  /** Timeout in ms — 0 or undefined means no timeout (Railway worker) */
  timeoutMs?: number;
  /** Called with status updates for progress tracking */
  onProgress?: (status: string) => void;
};

type QQPResult = {
  qqp_values: Record<string, { score: number; confidence: number; reasoning?: string }>;
  finishing_assessment: {
    level: string;
    coefficient: number;
    confidence: number;
    reasoning: string;
  };
};

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_WIDTH = 5000;
const DEFAULT_DPI = 300;
const DEFAULT_MAX_PAGES = 12;
const DEFAULT_THINKING_BUDGET = 10_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor() {
    super("Processing timed out — try a smaller PDF or fewer pages");
    this.name = "TimeoutError";
  }
}

function getImageMediaType(name: string): "image/jpeg" | "image/png" | "image/webp" {
  const l = name.toLowerCase();
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function setStatus(
  admin: SupabaseClient,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  await admin
    .from("estimations")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

function buildFloorContext(images: RenderedImage[]): string {
  const lines = images
    .filter((img) => img.floorLabels.length > 0)
    .map((img) => `Image "${img.name}": ${img.floorLabels.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "";
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function runEstimationPipeline(
  estimationId: string,
  admin: SupabaseClient,
  claude: Anthropic,
  options: PipelineOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const startTime = Date.now();
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const dpi = options.dpi ?? DEFAULT_DPI;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const thinkingBudget = options.thinkingBudget ?? DEFAULT_THINKING_BUDGET;
  const timeoutMs = options.timeoutMs ?? 0;
  const progress = options.onProgress ?? (() => {});

  function checkTimeout() {
    if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
      throw new TimeoutError();
    }
  }

  try {
    // ── Load estimation row ──────────────────────────────────────────────────
    const { data: est, error: estError } = await admin
      .from("estimations")
      .select("*")
      .eq("id", estimationId)
      .single();

    if (estError || !est) {
      return { success: false, error: "Estimation not found" };
    }

    // Idempotency guard
    const IN_PROGRESS = ["extracting_sqm", "analyzing_qqp", "calculating"];
    if (IN_PROGRESS.includes(est.status)) {
      return { success: false, error: `Already in progress (${est.status})` };
    }
    if (est.status === "completed" || est.status === "complete") {
      return { success: true };
    }

    if (!est.plan_storage_path) {
      await setStatus(admin, estimationId, "error", {
        error_message: "No plan file attached.",
      });
      return { success: false, error: "No plan file" };
    }

    // ── Load settings + prompts in parallel ──────────────────────────────────
    progress("loading_settings");
    const [settingsResult, prompts] = await Promise.all([
      admin
        .from("system_settings")
        .select("key, value")
        .in("key", [
          "extraction_model", "qqp_model",
          "cat1_price_min", "cat1_price_max",
          "cat2_price_min", "cat2_price_max",
          "cat3_price_min", "cat3_price_max",
          "abex_reference_year", "abex_reference_semester",
        ]),
      getPromptSettings(),
    ]);
    const settings = Object.fromEntries(
      (settingsResult.data ?? []).map((s) => [s.key, s.value]),
    );

    const extractionModel = (settings.extraction_model as string) ?? "claude-sonnet-4-6";
    const qqpModel = (settings.qqp_model as string) ?? "claude-sonnet-4-6";
    const abexYear = (settings.abex_reference_year as number) ?? 2026;
    const abexSemester = (settings.abex_reference_semester as number) ?? 1;

    const pricing: PricingConfig = {
      cat1_min: (settings.cat1_price_min as number) ?? 1100,
      cat1_max: (settings.cat1_price_max as number) ?? 1900,
      cat2_min: (settings.cat2_price_min as number) ?? 550,
      cat2_max: (settings.cat2_price_max as number) ?? 950,
      cat3_min: (settings.cat3_price_min as number) ?? 330,
      cat3_max: (settings.cat3_price_max as number) ?? 570,
    };

    // ── Download file from Storage ───────────────────────────────────────────
    checkTimeout();
    progress("downloading_pdf");

    const { data: fileBlob, error: storageError } = await admin.storage
      .from("plans")
      .download(est.plan_storage_path);

    if (storageError || !fileBlob) {
      await setStatus(admin, estimationId, "error", {
        error_message: `Storage download failed: ${storageError?.message ?? "unknown"}`,
      });
      return { success: false, error: "Storage download failed" };
    }

    const arrayBuffer = await fileBlob.arrayBuffer();

    // ── Page classification + SQM extraction ─────────────────────────────────
    await setStatus(admin, estimationId, "extracting_sqm");
    progress("extracting_sqm");

    const isPdf =
      est.plan_storage_path.toLowerCase().endsWith(".pdf") ||
      (est.plan_file_name ?? "").toLowerCase().endsWith(".pdf");

    let sqmExtraction: Record<string, unknown>;
    let planImageBlocks: Anthropic.ContentBlockParam[] = [];

    if (isPdf) {
      checkTimeout();

      // Local heuristic classification
      const { floorPlanPages, allClassifications } = await getFloorPlanPages(
        Buffer.from(arrayBuffer),
        40,
      );

      const planClassifications = allClassifications
        .filter((p) => floorPlanPages.includes(p.pageNumber))
        .slice(0, maxPages);

      // Try mupdf PNG rendering, fall back to PDF document blocks
      let sqmContent: Anthropic.MessageParam["content"];
      try {
        const planImages = await renderPdfPagesToImages(
          Buffer.from(arrayBuffer),
          planClassifications,
          { maxWidth, dpi },
        );

        const floorContext = buildFloorContext(planImages);

        planImageBlocks = planImages.flatMap(
          (img): Anthropic.ContentBlockParam[] => [
            { type: "text" as const, text: `\n--- Image: ${img.name} ---` },
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/png" as const,
                data: img.png.toString("base64"),
              },
            },
          ],
        );

        sqmContent = [
          {
            type: "text" as const,
            text: floorContext
              ? floorContext + "\n\n" + prompts.sqmUser
              : prompts.sqmUser,
          },
          ...planImageBlocks,
        ];
      } catch (renderErr) {
        console.warn(
          "[pipeline] mupdf render failed, using PDF documents:",
          (renderErr as Error).message?.slice(0, 100),
        );
        const { pages } = await splitPdfPages(Buffer.from(arrayBuffer), 40);
        const selectedPages = pages.filter((p) =>
          floorPlanPages.includes(p.pageNumber),
        );
        const pagesToSend = (
          selectedPages.length > 0 ? selectedPages : pages
        ).slice(0, maxPages);
        planImageBlocks = pagesToSend.flatMap(
          (page): Anthropic.ContentBlockParam[] => [
            { type: "text" as const, text: `\n--- Page ${page.pageNumber} ---` },
            {
              type: "document" as const,
              source: {
                type: "base64" as const,
                media_type: "application/pdf" as const,
                data: page.base64,
              },
            } as Anthropic.DocumentBlockParam,
          ],
        );
        sqmContent = [
          { type: "text" as const, text: prompts.sqmUser },
          ...planImageBlocks,
        ];
      }

      // SQM extraction with extended thinking
      const sqmCallStart = Date.now();
      const sqmRes = await claude.messages
        .stream({
          model: extractionModel,
          max_tokens: thinkingBudget + 16384,
          thinking: { type: "enabled", budget_tokens: thinkingBudget },
          system: prompts.sqmSystem,
          messages: [{ role: "user", content: sqmContent }],
        })
        .finalMessage();
      logApiCall({
        call_type: "sqm_extraction",
        estimation_id: estimationId,
        model_used: extractionModel,
        tokens_input: sqmRes.usage.input_tokens,
        tokens_output: sqmRes.usage.output_tokens,
        duration_ms: Date.now() - sqmCallStart,
        status: "success",
      });

      const sqmTextBlock = sqmRes.content.find((b) => b.type === "text");
      const sqmRaw =
        sqmTextBlock && "text" in sqmTextBlock ? sqmTextBlock.text : "";

      try {
        sqmExtraction = parseClaudeJson(sqmRaw) as Record<string, unknown>;
      } catch {
        // Retry once — no thinking, temperature=0
        checkTimeout();
        const retryStart = Date.now();
        const retryRes = await claude.messages
          .stream({
            model: extractionModel,
            max_tokens: 16384,
            temperature: 0,
            system: prompts.sqmSystem,
            messages: [
              { role: "user", content: sqmContent },
              { role: "assistant", content: sqmRaw },
              { role: "user", content: STRICT_JSON_RETRY_MESSAGE },
            ],
          })
          .finalMessage();
        logApiCall({
          call_type: "sqm_extraction",
          estimation_id: estimationId,
          model_used: extractionModel,
          tokens_input: retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms: Date.now() - retryStart,
          status: "success",
        });
        const retryTextBlock = retryRes.content.find((b) => b.type === "text");
        const retryRaw =
          retryTextBlock && "text" in retryTextBlock ? retryTextBlock.text : "";
        sqmExtraction = parseClaudeJson(retryRaw) as Record<string, unknown>;
      }
    } else {
      // Image file
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const mediaType = getImageMediaType(est.plan_file_name ?? "plan.jpg");

      planImageBlocks = [
        { type: "text" as const, text: "\n--- Image: plan ---" },
        {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mediaType,
            data: base64,
          },
        },
      ];

      const imgContent: Anthropic.MessageParam["content"] = [
        { type: "text" as const, text: prompts.sqmUser },
        ...planImageBlocks,
      ];

      const callStart = Date.now();
      const imgRes = await claude.messages
        .stream({
          model: extractionModel,
          max_tokens: thinkingBudget + 16384,
          thinking: { type: "enabled", budget_tokens: thinkingBudget },
          system: prompts.sqmSystem,
          messages: [{ role: "user", content: imgContent }],
        })
        .finalMessage();
      logApiCall({
        call_type: "sqm_extraction",
        estimation_id: estimationId,
        model_used: extractionModel,
        tokens_input: imgRes.usage.input_tokens,
        tokens_output: imgRes.usage.output_tokens,
        duration_ms: Date.now() - callStart,
        status: "success",
      });

      const textBlock = imgRes.content.find((b) => b.type === "text");
      const imgRaw = textBlock && "text" in textBlock ? textBlock.text : "";
      try {
        sqmExtraction = parseClaudeJson(imgRaw) as Record<string, unknown>;
      } catch {
        checkTimeout();
        const retryStart = Date.now();
        const retryRes = await claude.messages
          .stream({
            model: extractionModel,
            max_tokens: 16384,
            temperature: 0,
            system: prompts.sqmSystem,
            messages: [
              { role: "user", content: imgContent },
              { role: "assistant", content: imgRaw },
              { role: "user", content: STRICT_JSON_RETRY_MESSAGE },
            ],
          })
          .finalMessage();
        logApiCall({
          call_type: "sqm_extraction",
          estimation_id: estimationId,
          model_used: extractionModel,
          tokens_input: retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms: Date.now() - retryStart,
          status: "success",
        });
        const retryTextBlock = retryRes.content.find(
          (b) => b.type === "text",
        );
        const retryRaw =
          retryTextBlock && "text" in retryTextBlock ? retryTextBlock.text : "";
        sqmExtraction = parseClaudeJson(retryRaw) as Record<string, unknown>;
      }
    }

    // ── SQM post-processing ──────────────────────────────────────────────────
    const sqmBuildingType = getBuildingType(sqmExtraction);
    const sqmUnitCount = getUnitCount(sqmExtraction);
    const totalGrossSqm = getTotalGrossSqm(sqmExtraction);
    const areasForDisplay = categorizeAreas(sqmExtraction);
    const totalLivableSqm =
      areasForDisplay.cat1_sqm > 0 ? areasForDisplay.cat1_sqm : totalGrossSqm;

    const isApartmentBuilding =
      sqmBuildingType === "apartment_building" ||
      (sqmUnitCount != null && sqmUnitCount > 1);

    const v11bScaleConf = (
      sqmExtraction.project as Record<string, unknown> | undefined
    )?.scale_confidence as number | undefined;
    const sqmConfidence =
      v11bScaleConf ??
      (() => {
        const floors = (
          sqmExtraction.floors as
            | Array<{ rooms: Array<{ confidence: number }> }>
            | undefined
        ) ?? [];
        const allRoomConfs = floors.flatMap((f) =>
          (f.rooms ?? []).map((r) => r.confidence ?? 0.7),
        );
        return allRoomConfs.length > 0
          ? allRoomConfs.reduce((a, b) => a + b, 0) / allRoomConfs.length
          : 0.7;
      })();

    // ── QQP extraction ───────────────────────────────────────────────────────
    checkTimeout();
    await setStatus(admin, estimationId, "analyzing_qqp");
    progress("analyzing_qqp");

    const { data: qqpDefs } = await admin
      .from("qqp_definitions")
      .select("id, name, display_name, description, data_type, unit")
      .eq("is_active", true)
      .order("sort_order");

    const qqpUserPrompt = buildQQPUserPrompt(
      sqmExtraction,
      qqpDefs ?? [],
      undefined,
      prompts.qqpUserTemplate,
      isApartmentBuilding
        ? { unitCount: sqmUnitCount ?? null }
        : undefined,
      buildScoringGuides(QQP_REFERENCE_RANGES),
    );

    const qqpContent: Anthropic.MessageParam["content"] = [
      { type: "text" as const, text: qqpUserPrompt },
      ...planImageBlocks,
    ];

    const qqpCallStart = Date.now();
    const qqpResponse = await claude.messages
      .stream({
        model: qqpModel,
        max_tokens: 8192,
        system: prompts.qqpSystem,
        messages: [{ role: "user", content: qqpContent }],
      })
      .finalMessage();
    logApiCall({
      call_type: "qqp_extraction",
      estimation_id: estimationId,
      model_used: qqpModel,
      tokens_input: qqpResponse.usage.input_tokens,
      tokens_output: qqpResponse.usage.output_tokens,
      duration_ms: Date.now() - qqpCallStart,
      status: "success",
    });

    const qqpRaw =
      qqpResponse.content[0].type === "text"
        ? qqpResponse.content[0].text
        : "";

    let qqpExtraction: QQPResult;
    try {
      qqpExtraction = parseClaudeJson(qqpRaw) as QQPResult;
    } catch {
      checkTimeout();
      const retryStart = Date.now();
      const retryRes = await claude.messages
        .stream({
          model: qqpModel,
          max_tokens: 8192,
          system: prompts.qqpSystem,
          messages: [
            { role: "user", content: qqpContent },
            { role: "assistant", content: qqpRaw },
            { role: "user", content: STRICT_JSON_RETRY_MESSAGE },
          ],
        })
        .finalMessage();
      logApiCall({
        call_type: "qqp_extraction",
        estimation_id: estimationId,
        model_used: qqpModel,
        tokens_input: retryRes.usage.input_tokens,
        tokens_output: retryRes.usage.output_tokens,
        duration_ms: Date.now() - retryStart,
        status: "success",
      });
      const retryRaw =
        retryRes.content[0].type === "text" ? retryRes.content[0].text : "";
      qqpExtraction = parseClaudeJson(retryRaw) as QQPResult;
    }

    // ── Finishing coefficient ─────────────────────────────────────────────────
    await setStatus(admin, estimationId, "calculating");
    progress("calculating");

    const qqpScores = flattenQQPScores(qqpExtraction.qqp_values);
    let finishingCoefficient = 1.0;
    let modelVersionId: string | null = null;

    const { data: activeModel } = await admin
      .from("qqp_model_versions")
      .select("id, weights, intercept, training_config")
      .eq("is_active", true)
      .maybeSingle();

    if (activeModel?.intercept != null && activeModel?.weights) {
      const storedModel: StoredModel = {
        intercept: activeModel.intercept,
        weights: activeModel.weights as Record<string, number>,
      };
      finishingCoefficient = predictF(qqpScores, storedModel);
      modelVersionId = activeModel.id;
    }

    // ── Regional factor & ABEX ───────────────────────────────────────────────
    const extractedPostcode =
      ((sqmExtraction.project as Record<string, unknown> | undefined)
        ?.postcode as string | null | undefined) ??
      est.postcode ??
      null;

    const regionalLookup = getRegionalCoefficient(extractedPostcode);
    const regionalFactor = regionalLookup.coeff;

    console.log(
      `[pipeline] postcode=${extractedPostcode ?? "null"} → coeff=${regionalFactor} (${regionalLookup.label})`,
    );

    const { data: abexRow } = await admin
      .from("abex_index")
      .select("index_value")
      .eq("year", abexYear)
      .eq("semester", abexSemester)
      .maybeSingle();

    const abexFactor = abexRow ? Number(abexRow.index_value) / 1056 : 1.0;

    // ── Cost calculation ─────────────────────────────────────────────────────
    const areas = categorizeAreas(sqmExtraction);
    const costBreakdown = calculateCost(
      areas,
      finishingCoefficient,
      pricing,
      regionalFactor,
      abexFactor,
    );

    const qqpConfidence = qqpExtraction.finishing_assessment.confidence ?? 0.7;
    const overallConfidence = (sqmConfidence + qqpConfidence) / 2;

    // ── Write final result ───────────────────────────────────────────────────
    await admin
      .from("estimations")
      .update({
        building_type: sqmBuildingType,
        sqm_extraction: sqmExtraction,
        total_livable_sqm: totalLivableSqm,
        total_gross_sqm: totalGrossSqm,
        sub_areas: costBreakdown,
        extracted_qqps: qqpExtraction.qqp_values,
        finishing_level: costBreakdown.finishing_label,
        finishing_coefficient: finishingCoefficient,
        base_price_per_sqm: costBreakdown.cat1_price_per_sqm,
        abex_factor: abexFactor,
        estimated_price_per_sqm: costBreakdown.effective_price_per_livable_sqm,
        estimated_total_cost: costBreakdown.total_cost,
        sqm_confidence: sqmConfidence,
        qqp_confidence: qqpConfidence,
        overall_confidence: overallConfidence,
        model_version_id: modelVersionId,
        processing_time_ms: Date.now() - startTime,
        price_out_of_range: false,
        status: "complete",
        error_message: null,
        updated_at: new Date().toISOString(),
        postcode: extractedPostcode ?? est.postcode ?? null,
        postcode_provided_by: extractedPostcode ? "plan" : "user",
      })
      .eq("id", estimationId);

    progress("complete");
    return { success: true };
  } catch (err) {
    console.error("[pipeline]", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    await setStatus(admin, estimationId, "error", { error_message: msg });
    return { success: false, error: msg };
  }
}
