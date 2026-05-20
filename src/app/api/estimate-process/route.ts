import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/ai/client";
import {
  buildQQPUserPrompt,
  parseClaudeJson,
  STRICT_JSON_RETRY_MESSAGE,
} from "@/lib/ai/prompts";
import { renderPdfPagesToImages, type RenderedImage } from "@/lib/pdf/render-plans";
import { getFloorPlanPages } from "@/lib/pdf/classify-pages-local";
import { splitPdfPages } from "@/lib/pdf/split-pages";
import { applyModelWeights, flattenQQPValues } from "@/lib/qqp/model-prediction";
import { logApiCall } from "@/lib/ai/log-api-call";
import { categorizeAreas, getTotalGrossSqm, getBuildingType } from "@/lib/cost/area-categories";
import { calculateCost, interpolatePrice, type PricingConfig } from "@/lib/cost/calculate-cost";
import { getPromptSettings } from "@/lib/ai/prompt-settings";
import type Anthropic from "@anthropic-ai/sdk";

// Internal route — called fire-and-forget from /api/estimate.
// No auth check: the estimation row is fetched by ID and the pipeline writes
// back to that row only. The caller (/api/estimate) already validated auth
// and the existence of plan_storage_path before kicking this off.
export const maxDuration = 300;

const TIMEOUT_MS    = 250_000; // bail out before Vercel's 300s hard limit
const MAX_SQM_PAGES  = 12;     // hard cap on floor plan pages sent for SQM

// ── Timeout guard ─────────────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor() {
    super("Processing timed out — try a smaller PDF or fewer pages");
    this.name = "TimeoutError";
  }
}

function checkTimeout(startTime: number) {
  if (Date.now() - startTime > TIMEOUT_MS) throw new TimeoutError();
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function getImageMediaType(name: string): "image/jpeg" | "image/png" | "image/webp" {
  const l = name.toLowerCase();
  if (l.endsWith(".png"))  return "image/png";
  if (l.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function setStatus(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  status: string,
  extra: Record<string, unknown> = {}
) {
  await admin
    .from("estimations")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

const THINKING_BUDGET = 10000;

// ── Floor label context (ported from WS1 benchmark-pipeline.mjs) ─────────────

function buildFloorContext(images: RenderedImage[]): string {
  const lines = images
    .filter((img) => img.floorLabels.length > 0)
    .map((img) => `Image "${img.name}": ${img.floorLabels.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "";
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let estimationId: string | undefined;
  const admin = createSupabaseAdminClient();
  const startTime = Date.now();

  try {
    const body = await req.json() as { estimationId?: string };
    estimationId = body.estimationId;
    if (!estimationId) {
      return NextResponse.json({ error: "Missing estimationId" }, { status: 400 });
    }

    // Load estimation row
    const { data: est, error: estError } = await admin
      .from("estimations")
      .select("*")
      .eq("id", estimationId)
      .single();

    if (estError || !est) {
      return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
    }

    if (!est.plan_storage_path) {
      await setStatus(admin, estimationId, "error", { error_message: "No plan file attached." });
      return NextResponse.json({ error: "No plan file" }, { status: 422 });
    }

    // Load settings and prompts in parallel
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
      (settingsResult.data ?? []).map((s) => [s.key, s.value])
    );

    const extractionModel = (settings.extraction_model as string) ?? "claude-sonnet-4-6";
    const qqpModel        = (settings.qqp_model        as string) ?? "claude-sonnet-4-6";
    const abexYear        = (settings.abex_reference_year     as number) ?? 2026;
    const abexSemester    = (settings.abex_reference_semester as number) ?? 1;

    const pricing: PricingConfig = {
      cat1_min: (settings.cat1_price_min as number) ?? 1100,
      cat1_max: (settings.cat1_price_max as number) ?? 1900,
      cat2_min: (settings.cat2_price_min as number) ?? 550,
      cat2_max: (settings.cat2_price_max as number) ?? 950,
      cat3_min: (settings.cat3_price_min as number) ?? 330,
      cat3_max: (settings.cat3_price_max as number) ?? 570,
    };

    // ── Download file from Storage ────────────────────────────────────────────
    checkTimeout(startTime);

    const { data: fileBlob, error: storageError } = await admin.storage
      .from("plans")
      .download(est.plan_storage_path);

    if (storageError || !fileBlob) {
      await setStatus(admin, estimationId, "error", {
        error_message: `Storage download failed: ${storageError?.message ?? "unknown"}`,
      });
      return NextResponse.json({ error: "Storage error" }, { status: 500 });
    }

    const arrayBuffer = await fileBlob.arrayBuffer();

    // ── Page classification (PDF only) ────────────────────────────────────────
    await setStatus(admin, estimationId, "extracting_sqm");

    const isPdf =
      est.plan_storage_path.toLowerCase().endsWith(".pdf") ||
      (est.plan_file_name ?? "").toLowerCase().endsWith(".pdf");

    let sqmExtraction: Record<string, unknown>;

    // Plan image blocks — reused for both SQM and QQP calls
    let planImageBlocks: Anthropic.ContentBlockParam[] = [];

    if (isPdf) {
      checkTimeout(startTime);

      // Local heuristic classification (WS1 approach — keyword matching, no API cost)
      const { floorPlanPages, allClassifications } = await getFloorPlanPages(
        Buffer.from(arrayBuffer),
        40
      );

      // Filter to floor plan classifications, cap at MAX_SQM_PAGES
      const planClassifications = allClassifications
        .filter((p) => floorPlanPages.includes(p.pageNumber))
        .slice(0, MAX_SQM_PAGES);

      // Try mupdf PNG rendering first (WS1 quality), fall back to PDF document blocks
      let sqmContent: Anthropic.MessageParam["content"];
      try {
        const planImages = await renderPdfPagesToImages(
          Buffer.from(arrayBuffer),
          planClassifications,
          { maxWidth: 5000, dpi: 300 }
        );

        // Build floor label context (WS1 approach — helps Claude identify floors)
        const floorContext = buildFloorContext(planImages);

        // Save image blocks for reuse in QQP call
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
          ]
        );

        // WS1 order: context + user prompt first, then labeled images
        sqmContent = [
          { type: "text" as const, text: floorContext ? floorContext + "\n\n" + prompts.sqmUser : prompts.sqmUser },
          ...planImageBlocks,
        ];
      } catch (renderErr) {
        // mupdf not available on this runtime — fall back to PDF document blocks
        console.warn("[estimate-process] mupdf render failed, using PDF documents:", (renderErr as Error).message?.slice(0, 100));
        const { pages } = await splitPdfPages(Buffer.from(arrayBuffer), 40);
        const selectedPages = pages.filter((p) =>
          floorPlanPages.includes(p.pageNumber)
        );
        const pagesToSend = (selectedPages.length > 0 ? selectedPages : pages).slice(0, MAX_SQM_PAGES);
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
          ]
        );
        sqmContent = [
          { type: "text" as const, text: prompts.sqmUser },
          ...planImageBlocks,
        ];
      }

      // SQM extraction with extended thinking (streaming to handle >10min ops)
      const sqmCallStart = Date.now();
      const sqmRes = await anthropic.messages.stream({
        model: extractionModel,
        max_tokens: THINKING_BUDGET + 16384,
        thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
        system: prompts.sqmSystem,
        messages: [{ role: "user", content: sqmContent }],
      }).finalMessage();
      logApiCall({
        call_type:     "sqm_extraction",
        estimation_id: estimationId,
        model_used:    extractionModel,
        tokens_input:  sqmRes.usage.input_tokens,
        tokens_output: sqmRes.usage.output_tokens,
        duration_ms:   Date.now() - sqmCallStart,
        status:        "success",
      });

      const sqmTextBlock = sqmRes.content.find((b) => b.type === "text");
      const sqmRaw = sqmTextBlock && "text" in sqmTextBlock ? sqmTextBlock.text : "";

      try {
        sqmExtraction = parseClaudeJson(sqmRaw) as Record<string, unknown>;
      } catch {
        // Retry once — no thinking, temperature=0
        const retryStart = Date.now();
        const retryRes = await anthropic.messages.stream({
          model: extractionModel,
          max_tokens: 16384,
          temperature: 0,
          system: prompts.sqmSystem,
          messages: [
            { role: "user",      content: sqmContent },
            { role: "assistant", content: sqmRaw },
            { role: "user",      content: STRICT_JSON_RETRY_MESSAGE },
          ],
        }).finalMessage();
        logApiCall({
          call_type:     "sqm_extraction",
          estimation_id: estimationId,
          model_used:    extractionModel,
          tokens_input:  retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms:   Date.now() - retryStart,
          status:        "success",
        });
        const retryTextBlock = retryRes.content.find((b) => b.type === "text");
        const retryRaw = retryTextBlock && "text" in retryTextBlock ? retryTextBlock.text : "";
        sqmExtraction = parseClaudeJson(retryRaw) as Record<string, unknown>;
      }
    } else {
      // Image file — render as single image with thinking (WS1 flow)
      const base64    = Buffer.from(arrayBuffer).toString("base64");
      const mediaType = getImageMediaType(est.plan_file_name ?? "plan.jpg");

      planImageBlocks = [
        { type: "text" as const, text: "\n--- Image: plan ---" },
        {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType, data: base64 },
        },
      ];

      const imgContent: Anthropic.MessageParam["content"] = [
        { type: "text" as const, text: prompts.sqmUser },
        ...planImageBlocks,
      ];

      const callStart = Date.now();
      const imgRes = await anthropic.messages.stream({
        model:      extractionModel,
        max_tokens: THINKING_BUDGET + 16384,
        thinking:   { type: "enabled", budget_tokens: THINKING_BUDGET },
        system:     prompts.sqmSystem,
        messages:   [{ role: "user", content: imgContent }],
      }).finalMessage();
      logApiCall({
        call_type:     "sqm_extraction",
        estimation_id: estimationId,
        model_used:    extractionModel,
        tokens_input:  imgRes.usage.input_tokens,
        tokens_output: imgRes.usage.output_tokens,
        duration_ms:   Date.now() - callStart,
        status:        "success",
      });

      const textBlock = imgRes.content.find((b) => b.type === "text");
      const imgRaw = textBlock && "text" in textBlock ? textBlock.text : "";
      try {
        sqmExtraction = parseClaudeJson(imgRaw) as Record<string, unknown>;
      } catch {
        checkTimeout(startTime);
        const retryStart = Date.now();
        const retryRes = await anthropic.messages.stream({
          model:      extractionModel,
          max_tokens: 16384,
          temperature: 0,
          system:     prompts.sqmSystem,
          messages: [
            { role: "user",      content: imgContent },
            { role: "assistant", content: imgRaw },
            { role: "user",      content: STRICT_JSON_RETRY_MESSAGE },
          ],
        }).finalMessage();
        logApiCall({
          call_type:     "sqm_extraction",
          estimation_id: estimationId,
          model_used:    extractionModel,
          tokens_input:  retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms:   Date.now() - retryStart,
          status:        "success",
        });
        const retryTextBlock = retryRes.content.find((b) => b.type === "text");
        const retryRaw = retryTextBlock && "text" in retryTextBlock ? retryTextBlock.text : "";
        sqmExtraction = parseClaudeJson(retryRaw) as Record<string, unknown>;
      }
    }

    // v11b+legacy compatible data extraction
    const sqmBuildingType = getBuildingType(sqmExtraction);
    const totalGrossSqm = getTotalGrossSqm(sqmExtraction);
    // v11b doesn't separate livable from gross; cat1 = livable enclosed
    const areasForDisplay = categorizeAreas(sqmExtraction);
    const totalLivableSqm = areasForDisplay.cat1_sqm > 0 ? areasForDisplay.cat1_sqm : totalGrossSqm;

    // Confidence: v11b uses project-level scale_confidence; legacy uses per-room confidence
    const v11bScaleConf = (sqmExtraction.project as Record<string, unknown> | undefined)?.scale_confidence as number | undefined;
    const sqmConfidence = v11bScaleConf ?? (() => {
      const floors = (sqmExtraction.floors as Array<{ rooms: Array<{ confidence: number }> }>) ?? [];
      const allRoomConfs = floors.flatMap((f) => (f.rooms ?? []).map((r) => r.confidence ?? 0.7));
      return allRoomConfs.length > 0
        ? allRoomConfs.reduce((a, b) => a + b, 0) / allRoomConfs.length
        : 0.7;
    })();

    // ── QQP extraction ────────────────────────────────────────────────────────
    checkTimeout(startTime);
    await setStatus(admin, estimationId, "analyzing_qqp");

    const { data: qqpDefs } = await admin
      .from("qqp_definitions")
      .select("id, name, display_name, description, data_type, unit")
      .eq("is_active", true)
      .order("sort_order");

    const qqpUserPrompt = buildQQPUserPrompt(
      sqmExtraction,
      qqpDefs ?? [],
      undefined,
      prompts.qqpUserTemplate
    );

    // Build QQP content: text prompt + plan images so Claude can assess
    // finishing quality from visible materials, fixtures, and spatial layout
    const qqpContent: Anthropic.MessageParam["content"] = [
      { type: "text" as const, text: qqpUserPrompt },
      ...planImageBlocks,
    ];

    const qqpCallStart = Date.now();
    const qqpResponse = await anthropic.messages.stream({
      model:      qqpModel,
      max_tokens: 8192,
      system:     prompts.qqpSystem,
      messages:   [{ role: "user", content: qqpContent }],
    }).finalMessage();
    logApiCall({
      call_type:     "qqp_extraction",
      estimation_id: estimationId,
      model_used:    qqpModel,
      tokens_input:  qqpResponse.usage.input_tokens,
      tokens_output: qqpResponse.usage.output_tokens,
      duration_ms:   Date.now() - qqpCallStart,
      status:        "success",
    });

    const qqpRaw = qqpResponse.content[0].type === "text" ? qqpResponse.content[0].text : "";
    type QQPResult = {
      qqp_values: Record<string, { value: unknown; confidence: number; notes?: string }>;
      finishing_assessment: {
        level:      string;
        coefficient: number;
        confidence: number;
        reasoning:  string;
      };
    };

    let qqpExtraction: QQPResult;
    try {
      qqpExtraction = parseClaudeJson(qqpRaw) as QQPResult;
    } catch {
      checkTimeout(startTime);
      const retryStart = Date.now();
      const retryRes = await anthropic.messages.stream({
        model:      qqpModel,
        max_tokens: 8192,
        system:     prompts.qqpSystem,
        messages: [
          { role: "user",      content: qqpContent },
          { role: "assistant", content: qqpRaw },
          { role: "user",      content: STRICT_JSON_RETRY_MESSAGE },
        ],
      }).finalMessage();
      logApiCall({
        call_type:     "qqp_extraction",
        estimation_id: estimationId,
        model_used:    qqpModel,
        tokens_input:  retryRes.usage.input_tokens,
        tokens_output: retryRes.usage.output_tokens,
        duration_ms:   Date.now() - retryStart,
        status:        "success",
      });
      const retryRaw = retryRes.content[0].type === "text" ? retryRes.content[0].text : "";
      qqpExtraction = parseClaudeJson(retryRaw) as QQPResult;
    }

    // ── Finishing coefficient ─────────────────────────────────────────────────
    await setStatus(admin, estimationId, "calculating");

    // Default to 1.0 ("Standard") until enough reference dossiers are
    // processed to train a reliable model. The QQP call now receives plan
    // images for better qqp_values extraction, but the raw AI coefficient
    // is not used — only a trained model can override the default.
    const DEFAULT_FINISHING_COEFFICIENT = 1.0;

    let finishingCoefficient = DEFAULT_FINISHING_COEFFICIENT;
    let modelVersionId: string | null = null;

    const { data: activeModel } = await admin
      .from("qqp_model_versions")
      .select("id, weights")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeModel?.weights) {
      const flatValues      = flattenQQPValues(qqpExtraction.qqp_values);
      const modelPrediction = applyModelWeights(
        flatValues,
        (qqpDefs ?? []).map((d) => ({ name: d.name, data_type: d.data_type })),
        activeModel.weights as Record<string, unknown>
      );
      if (modelPrediction !== null) {
        finishingCoefficient = modelPrediction;
        modelVersionId = activeModel.id;
      }
    }

    // ── Regional factor & ABEX ────────────────────────────────────────────────
    const { data: postcodeRow } = await admin
      .from("postcode_prices")
      .select("base_price_per_sqm, municipality, region")
      .eq("postcode", est.postcode ?? "")
      .maybeSingle();

    const cat1AtF1       = interpolatePrice(1.0, pricing.cat1_min, pricing.cat1_max);
    const regionalFactor = postcodeRow
      ? Number(postcodeRow.base_price_per_sqm) / cat1AtF1
      : 1.0;

    const { data: abexRow } = await admin
      .from("abex_index")
      .select("index_value")
      .eq("year", abexYear)
      .eq("semester", abexSemester)
      .maybeSingle();

    const abexFactor = abexRow ? Number(abexRow.index_value) / 1000 : 1.0;

    // ── Area categorisation & cost calculation ────────────────────────────────
    const areas         = categorizeAreas(sqmExtraction);
    const costBreakdown = calculateCost(areas, finishingCoefficient, pricing, regionalFactor, abexFactor);

    const qqpConfidence     = qqpExtraction.finishing_assessment.confidence ?? 0.7;
    const overallConfidence = (sqmConfidence + qqpConfidence) / 2;

    await admin
      .from("estimations")
      .update({
        building_type:           sqmBuildingType,
        sqm_extraction:          sqmExtraction,
        total_livable_sqm:       totalLivableSqm,
        total_gross_sqm:         totalGrossSqm,
        sub_areas:               costBreakdown,
        extracted_qqps:          qqpExtraction.qqp_values,
        finishing_level:         costBreakdown.finishing_label,
        finishing_coefficient:   finishingCoefficient,
        base_price_per_sqm:      postcodeRow ? Number(postcodeRow.base_price_per_sqm) : cat1AtF1,
        abex_factor:             abexFactor,
        estimated_price_per_sqm: costBreakdown.effective_price_per_livable_sqm,
        estimated_total_cost:    costBreakdown.total_cost,
        sqm_confidence:          sqmConfidence,
        qqp_confidence:          qqpConfidence,
        overall_confidence:      overallConfidence,
        model_version_id:        modelVersionId,
        processing_time_ms:      Date.now() - startTime,
        price_out_of_range:      false,
        status:                  "complete",
        error_message:           null,
        updated_at:              new Date().toISOString(),
        postcode:                est.postcode,
      })
      .eq("id", estimationId);

    return NextResponse.json({ success: true, estimationId });

  } catch (err) {
    console.error("[estimate-process]", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    if (estimationId) {
      await admin
        .from("estimations")
        .update({
          status:        "error",
          error_message: msg,
          updated_at:    new Date().toISOString(),
        })
        .eq("id", estimationId);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
