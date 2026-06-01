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
import {
  renderPdfPagesToImages,
  renderSpecificPagesToBase64,
  renderPlanTilesToBase64,
  tileImageToBase64,
  getPdfText,
  type RenderedImage,
} from "@/lib/pdf/render-plans";
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
import { computeSqmConfidence } from "@/lib/sqm/sqm-confidence";
import { detectSqmSource, type SqmSource } from "@/lib/sqm/sqm-router";
import {
  extractAreaTableViaVision,
  type AreaTableExtraction,
} from "@/lib/sqm/extract-area-table";
import {
  extractSqmViaVision,
  aggregateVisionSqm,
  type VisionSqmResult,
} from "@/lib/sqm/vision-extract";
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
  const { error } = await admin
    .from("estimations")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
  if (error) {
    console.error(`[pipeline] setStatus(${status}) failed:`, error.message);
  }
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
    // 1-indexed floor-plan page numbers (PDF only) — reused for the tiled label route.
    let floorPlanPageNums: number[] = [];

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
      floorPlanPageNums = planClassifications.map((p) => p.pageNumber);

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
    const visionAreas = categorizeAreas(sqmExtraction);

    // Base64 of the plan images we already rendered (PDF pages OR a JPEG/PNG upload),
    // reused by the universal vision extractor below — no extra render.
    const planImagesB64: string[] = planImageBlocks
      .filter(
        (b): b is Anthropic.ImageBlockParam =>
          b.type === "image" && (b.source as { type?: string })?.type === "base64",
      )
      .map((b) => (b.source as { data: string }).data);

    // ── SQM router — Route A: structured area-table override ─────────────────
    // Benchmark 2026-05-31: vision MEASUREMENT of bare raster plans is unreliable
    // (12 methods, ~38% even at high confidence — irreducible vision limit). BUT
    // when a dossier contains a structured area table (architect oppervlaktestaat /
    // meetstaat / berekening), reading that table with VISION is EXACT (validated
    // median 0%, 23/23 within 5% vs heated-floor GT). The router detects the table
    // from reliable text markers and overrides the measured areas with the table.
    let sqmSource: SqmSource = "plan_vision";
    let areaTable: AreaTableExtraction | null = null;
    if (isPdf) {
      try {
        const pdfText = await getPdfText(Buffer.from(arrayBuffer));
        const detected = detectSqmSource(pdfText);
        sqmSource = detected.source;
        // Always ATTEMPT the area-table route via vision. extractAreaTableViaVision
        // self-guards: it locates table pages from header markers ("Berekening",
        // "Opp/inhoud", "meetstaat" — extractable even when the table VALUES are a
        // non-extractable font) and returns found=false cheaply if there are none.
        // This lifts table coverage far beyond the strict text-detector (which only
        // fired on 7/37 CED dossiers because pdftotext can't read the table values).
        {
          areaTable = await extractAreaTableViaVision(
            pdfText,
            (pages) =>
              renderSpecificPagesToBase64(Buffer.from(arrayBuffer), pages),
            async ({ system, text, imagesB64 }) => {
              const res = await claude.messages.create({
                model: extractionModel,
                max_tokens: 4096,
                system,
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text" as const, text },
                      ...imagesB64.map((b) => ({
                        type: "image" as const,
                        source: {
                          type: "base64" as const,
                          media_type: "image/png" as const,
                          data: b,
                        },
                      })),
                    ],
                  },
                ],
              });
              const blk = res.content.find((c) => c.type === "text");
              const raw = blk && "text" in blk ? blk.text : "";
              try {
                return parseClaudeJson(raw) as Record<string, unknown>;
              } catch {
                return null;
              }
            },
          );
        }
      } catch (e) {
        console.warn(
          `[pipeline] route-A area-table detection failed (${estimationId}):`,
          (e as Error).message?.slice(0, 120),
        );
      }
    }

    const useRouteA = !!areaTable?.found && areaTable.areas.cat1 >= 20;

    // ── Universal vision extractor ───────────────────────────────────────────
    // Runs when route A (vision area-table) did NOT find a structured table. Works on
    // rendered PDF floor pages (tiled, per-page) OR a JPEG/PNG upload — so this is what
    // finally makes image uploads route correctly. It reads the best available signal:
    //   • a table/meetstaat the text path can't read (non-extractable fonts, or a JPEG
    //     photo of a table) → area_table, EXACT;
    //   • printed m² labels → labeled_plan, medium confidence;
    //   • only dimensions → bare_plan, low confidence (we keep the detailed v9
    //     measurement for those and just flag them).
    const callVisionJson = async ({
      system,
      text,
      imagesB64,
    }: {
      system: string;
      text: string;
      imagesB64: string[];
    }) => {
      const res = await claude.messages.create({
        model: extractionModel,
        max_tokens: 4500,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "text" as const, text },
              ...imagesB64.map((b) => ({
                type: "image" as const,
                source: { type: "base64" as const, media_type: "image/png" as const, data: b },
              })),
            ],
          },
        ],
      });
      const blk = res.content.find((c) => c.type === "text");
      const raw = blk && "text" in blk ? blk.text : "";
      try {
        return parseClaudeJson(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    let visionSqm: VisionSqmResult | null = null;
    if (!useRouteA && planImagesB64.length) {
      try {
        if (isPdf && floorPlanPageNums.length) {
          // PER-PAGE aggregation: multi-floor buildings put each floor on its own
          // sheet, so we tile + extract EACH floor page and sum (validated −0% on a
          // 12-floor apartment building). The API downsamples to ~1568px, so tiling is
          // what keeps the small printed m² labels legible. Capped to bound cost/time.
          const FLOOR_PAGE_CAP = 8;
          const pagesToScan = floorPlanPageNums.slice(0, FLOOR_PAGE_CAP);
          const perPage: Array<VisionSqmResult | null> = [];
          for (const pageNum of pagesToScan) {
            checkTimeout();
            const tiles = await renderPlanTilesToBase64(Buffer.from(arrayBuffer), [pageNum], {
              maxTiles: 9,
            });
            if (!tiles.length) continue;
            perPage.push(await extractSqmViaVision(tiles, callVisionJson));
          }
          visionSqm = aggregateVisionSqm(perPage);
        } else {
          // JPEG / image upload, or a PDF with no classified floor pages. For an image
          // upload, TILE it (overview + 3×3) so printed labels/dimensions survive the
          // ~1568px API downsample — same legibility win as PDF tiling.
          let imgs = planImagesB64;
          if (!isPdf) {
            try {
              const tiles = await tileImageToBase64(Buffer.from(arrayBuffer));
              if (tiles.length) imgs = tiles;
            } catch {
              /* fall back to the full image */
            }
          }
          visionSqm = await extractSqmViaVision(imgs, callVisionJson);
        }
      } catch (e) {
        console.warn(
          `[pipeline] universal vision extract failed (${estimationId}):`,
          (e as Error).message?.slice(0, 120),
        );
      }
    }

    // ── Resolve the SQM source — highest-reliability signal wins ──────────────
    const mapAreas = (a: { cat1: number; cat2: number; cat3: number }) => ({
      cat1_sqm: a.cat1,
      cat2_sqm: a.cat2,
      cat3_sqm: a.cat3,
    });
    type SqmTier = "area_table" | "area_table_vision" | "labeled_plan" | "plan_vision";
    let resolvedTier: SqmTier;
    let areasForDisplay: { cat1_sqm: number; cat2_sqm: number; cat3_sqm: number };
    if (useRouteA && areaTable) {
      resolvedTier = "area_table";
      areasForDisplay = mapAreas(areaTable.areas);
    } else if (visionSqm && visionSqm.kind === "area_table" && visionSqm.areas.cat1 >= 20) {
      resolvedTier = "area_table_vision";
      areasForDisplay = mapAreas(visionSqm.areas);
    } else if (visionSqm && visionSqm.kind === "labeled_plan" && visionSqm.areas.cat1 >= 20) {
      resolvedTier = "labeled_plan";
      areasForDisplay = mapAreas(visionSqm.areas);
    } else {
      resolvedTier = "plan_vision";
      // prefer the detailed v9 measurement; fall back to the universal measure if v9 gave ~0
      areasForDisplay =
        visionAreas.cat1_sqm >= 20 || !visionSqm ? visionAreas : mapAreas(visionSqm.areas);
    }
    console.log(
      `[pipeline] SQM source (${estimationId}): tier=${resolvedTier} textHint=${sqmSource} → cat1=${Math.round(areasForDisplay.cat1_sqm)} cat2=${Math.round(areasForDisplay.cat2_sqm)} cat3=${Math.round(areasForDisplay.cat3_sqm)} m²` +
        (visionSqm ? ` [vision kind=${visionSqm.kind} conf=${visionSqm.confidence}]` : ""),
    );

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

    // Physical sanity-gating (benchmark 2026-05-31): vision SQM measurement is
    // unreliable (12 methods tested, irreducible variance). We cannot make the
    // measured NUMBER reliably accurate, but we CAN detect physically-implausible
    // extractions (gross<net, near-zero livable, absurd m²/unit) and downgrade
    // confidence so the tool flags them for manual review instead of silently
    // emitting a wrong SQM.
    const sqmSanity = computeSqmConfidence({
      cat1Sqm: areasForDisplay.cat1_sqm,
      cat2Sqm: areasForDisplay.cat2_sqm,
      cat3Sqm: areasForDisplay.cat3_sqm,
      unitCount: sqmUnitCount,
      // under-capture cross-check: a printed total floor area from the labeled route
      // (null for Route A, which is exact and has no stated m² total).
      statedTotalSqm: visionSqm?.statedTotal ?? null,
    });
    // Confidence by tier: an exact table (text- or vision-read) is trustworthy;
    // printed labels are medium (capped, capture varies); a bare measurement is gated
    // down by the physical sanity checks and flagged.
    let gatedSqmConfidence: number;
    if (resolvedTier === "area_table") gatedSqmConfidence = Math.max(0.9, sqmConfidence);
    else if (resolvedTier === "area_table_vision") gatedSqmConfidence = 0.9;
    else if (resolvedTier === "labeled_plan") {
      // Safe default: unverified labels stay medium (≤0.6 → manual panel). A printed
      // TOTAL that AGREES with the captured sum = verified-complete → trust (skip panel);
      // a shortfall = incomplete capture → downgrade + flag.
      gatedSqmConfidence = Math.min(0.6, visionSqm?.confidence ?? 0.5, sqmSanity.score + 0.15);
      const total = visionSqm?.statedTotal ?? 0;
      if (total > 50) {
        const ratio =
          (areasForDisplay.cat1_sqm + areasForDisplay.cat2_sqm + areasForDisplay.cat3_sqm) / total;
        if (ratio >= 0.9 && ratio <= 1.15) gatedSqmConfidence = Math.max(gatedSqmConfidence, 0.72);
        else if (ratio < 0.7) gatedSqmConfidence = Math.min(gatedSqmConfidence, 0.4);
      }
    } else gatedSqmConfidence = Math.min(sqmConfidence, sqmSanity.score);
    if (resolvedTier !== "area_table" && resolvedTier !== "area_table_vision" && sqmSanity.flags.length > 0) {
      console.warn(
        `[pipeline] SQM sanity (${estimationId}) ${sqmSanity.level} (${sqmSanity.score}): ${sqmSanity.flags.join(" | ")}`,
      );
    }

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
    // areasForDisplay is the routed result (Route A table override when present,
    // else vision measurement) — use it so the cost reflects the best SQM source.
    const areas = areasForDisplay;
    const costBreakdown = calculateCost(
      areas,
      finishingCoefficient,
      pricing,
      regionalFactor,
      abexFactor,
    );

    const qqpConfidence = qqpExtraction.finishing_assessment.confidence ?? 0.7;
    const overallConfidence = (gatedSqmConfidence + qqpConfidence) / 2;

    // ── Write final result ───────────────────────────────────────────────────
    const { error: finalUpdateErr } = await admin
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
        sqm_confidence: gatedSqmConfidence,
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

    if (finalUpdateErr) {
      console.error("[pipeline] Final update failed:", finalUpdateErr.message);
      // Try a minimal status-only update as fallback
      await setStatus(admin, estimationId, "complete");
    }

    progress("complete");
    return { success: true };
  } catch (err) {
    console.error("[pipeline]", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    await setStatus(admin, estimationId, "error", { error_message: msg });
    return { success: false, error: msg };
  }
}
