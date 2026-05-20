import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { anthropic } from "@/lib/ai/client";
import {
  buildQQPUserPrompt,
  parseClaudeJson,
  STRICT_JSON_RETRY_MESSAGE,
} from "@/lib/ai/prompts";
import { splitPdfPages } from "@/lib/pdf/split-pages";
import { classifyPages } from "@/lib/pdf/classify-pages";
import { extractMetadata } from "@/lib/pdf/extract-metadata";
import { evaluateDiscoveries } from "@/lib/qqp/discovery-engine";
import { shouldAutoCalibrate, calibrateWeights } from "@/lib/qqp/weight-calibration";
import { logApiCall } from "@/lib/ai/log-api-call";
import { categorizeAreas } from "@/lib/cost/area-categories";
import { calculateCost, interpolatePrice, type PricingConfig } from "@/lib/cost/calculate-cost";
import { getPromptSettings } from "@/lib/ai/prompt-settings";
import type { PageClassification } from "@/lib/pdf/classify-pages";
import type Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

function getImageMediaType(
  fileName: string
): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function setStatus(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  status: string,
  extra: Record<string, unknown> = {}
) {
  await admin
    .from("reference_dossiers")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

export async function POST(req: NextRequest) {
  let dossierId: string | undefined;
  const admin = createSupabaseAdminClient();
  const startTime = Date.now();

  try {
    const body = await req.json();
    dossierId = (body as { dossierId?: string }).dossierId;
    if (!dossierId) {
      return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
    }

    if (!SKIP_AUTH) {
      const supabase = createSupabaseServerClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const { data: userRow } = await admin
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      if (!userRow?.tenant_id) {
        return NextResponse.json({ error: "No tenant" }, { status: 403 });
      }
    }

    const { data: dossier, error: dossierError } = await admin
      .from("reference_dossiers")
      .select("*")
      .eq("id", dossierId)
      .single();

    if (dossierError || !dossier) {
      return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
    }

    if (!dossier.plan_storage_path) {
      await setStatus(admin, dossierId, "error", {
        error_message: "No plan file attached to this dossier.",
      });
      return NextResponse.json({ error: "No plan file" }, { status: 422 });
    }

    // Load settings and prompts in parallel
    const [settingsResult, prompts] = await Promise.all([
      admin
        .from("system_settings")
        .select("key, value")
        .in("key", [
          "extraction_model",
          "qqp_model",
          "qqp_residual_trigger",
          "cat1_price_min", "cat1_price_max",
          "cat2_price_min", "cat2_price_max",
          "cat3_price_min", "cat3_price_max",
          "abex_reference_year", "abex_reference_semester",
        ]),
      getPromptSettings(),
    ]);
    const settingsRows = settingsResult.data;

    const settings = Object.fromEntries(
      (settingsRows ?? []).map((s) => [s.key, s.value])
    );
    const extractionModel =
      (settings.extraction_model as string) ?? "claude-sonnet-4-6";
    const qqpModel =
      (settings.qqp_model as string) ?? "claude-sonnet-4-6";
    const residualTrigger = 0.15;
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

    // Download plan from Storage
    const { data: fileBlob, error: storageError } = await admin.storage
      .from("plans")
      .download(dossier.plan_storage_path);

    if (storageError || !fileBlob) {
      await setStatus(admin, dossierId, "error", {
        error_message: `Storage download failed: ${storageError?.message ?? "unknown error"}`,
      });
      return NextResponse.json({ error: "Storage error" }, { status: 500 });
    }

    const arrayBuffer = await fileBlob.arrayBuffer();

    // ── Build SQM content blocks ──────────────────────────────────────────────
    let sqmContent: Anthropic.MessageParam["content"];
    let effectiveClassifications = dossier.page_classifications as PageClassification[] | null;

    if (dossier.plan_file_type === "pdf") {
      const { pages } = await splitPdfPages(Buffer.from(arrayBuffer), 40);

      // ── Step A: Classify pages if not already stored ──────────────────────
      if (!effectiveClassifications) {
        const classifyStart = Date.now();
        effectiveClassifications = await classifyPages(pages, extractionModel, prompts.pageClassification);
        logApiCall({
          call_type: "page_classification",
          dossier_id: dossierId,
          model_used: extractionModel,
          duration_ms: Date.now() - classifyStart,
          status: "success",
        });
        await admin
          .from("reference_dossiers")
          .update({ page_classifications: effectiveClassifications })
          .eq("id", dossierId);
      }

      // ── Step B: Extract metadata from expert_report / pricing_table pages ──
      let extractedMeta = null;
      const metaStart = Date.now();
      try {
        extractedMeta = await extractMetadata(pages, effectiveClassifications, extractionModel, prompts.metadataUser);
        logApiCall({
          call_type: "metadata_extraction",
          dossier_id: dossierId,
          model_used: extractionModel,
          duration_ms: Date.now() - metaStart,
          status: "success",
        });
      } catch {
        logApiCall({
          call_type: "metadata_extraction",
          dossier_id: dossierId,
          model_used: extractionModel,
          duration_ms: Date.now() - metaStart,
          status: "error",
        });
      }

      if (extractedMeta) {
        const metaUpdate: Record<string, unknown> = {};
        if (!dossier.address && extractedMeta.address) metaUpdate.address = extractedMeta.address;
        if (!dossier.postcode && extractedMeta.postcode) metaUpdate.postcode = extractedMeta.postcode;
        if (!dossier.municipality && extractedMeta.municipality) metaUpdate.municipality = extractedMeta.municipality;
        if (!dossier.building_type && extractedMeta.building_type) metaUpdate.building_type = extractedMeta.building_type;
        if (!dossier.known_total_price && extractedMeta.known_total_price) metaUpdate.known_total_price = extractedMeta.known_total_price;
        if (!dossier.known_total_sqm && extractedMeta.known_total_sqm) metaUpdate.known_total_sqm = extractedMeta.known_total_sqm;
        if (!dossier.known_price_per_sqm) {
          const derivedPrice =
            extractedMeta.known_price_per_sqm ??
            (extractedMeta.known_total_price && extractedMeta.known_total_sqm && extractedMeta.known_total_sqm > 0
              ? extractedMeta.known_total_price / extractedMeta.known_total_sqm
              : null);
          if (derivedPrice) metaUpdate.known_price_per_sqm = derivedPrice;
        }
        if (!dossier.expert_finishing_level && extractedMeta.expert_finishing_level)
          metaUpdate.expert_finishing_level = extractedMeta.expert_finishing_level;
        if (extractedMeta.apartment_count != null && extractedMeta.apartment_count > 1) {
          metaUpdate.apartment_count = extractedMeta.apartment_count;
          metaUpdate.building_type = "apartment_building";
        }

        if (Object.keys(metaUpdate).length > 0) {
          await admin.from("reference_dossiers").update(metaUpdate).eq("id", dossierId);
          Object.assign(dossier, metaUpdate);
        }
      }

      // ── Step C: Build floor-plan page content for SQM extraction ──────────
      const floorPlanNums = new Set(
        effectiveClassifications
          .filter((c) => c.type === "floor_plan")
          .map((c) => c.pageNumber)
      );

      const planPages =
        floorPlanNums.size > 0
          ? pages.filter((p) => floorPlanNums.has(p.pageNumber))
          : pages;

      if (planPages.length === 0) {
        await setStatus(admin, dossierId, "error", {
          error_message: "No floor plan pages found in PDF to extract SQM from.",
        });
        return NextResponse.json({ error: "No floor plan pages" }, { status: 422 });
      }

      sqmContent = [
        ...planPages.map(
          (p): Anthropic.DocumentBlockParam => ({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: p.base64 },
          })
        ),
        { type: "text", text: prompts.sqmUser },
      ];
    } else {
      // Image file — no classification or metadata extraction
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const mediaType = getImageMediaType(dossier.plan_file_name ?? "plan.jpg");
      sqmContent = [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        },
        { type: "text", text: prompts.sqmUser },
      ];
    }

    // ── SQM Extraction ────────────────────────────────────────────────────────
    await setStatus(admin, dossierId, "extracting_sqm", { error_message: null });

    const sqmCallStart = Date.now();
    const sqmResponse = await anthropic.messages.create({
      model: extractionModel,
      max_tokens: 16384,
      system: prompts.sqmSystem,
      messages: [{ role: "user", content: sqmContent }],
    });
    logApiCall({
      call_type: "sqm_extraction",
      dossier_id: dossierId,
      model_used: extractionModel,
      tokens_input: sqmResponse.usage.input_tokens,
      tokens_output: sqmResponse.usage.output_tokens,
      duration_ms: Date.now() - sqmCallStart,
      status: "success",
    });

    const sqmRaw =
      sqmResponse.content[0].type === "text" ? sqmResponse.content[0].text : "";

    let sqmExtraction: Record<string, unknown>;
    try {
      sqmExtraction = parseClaudeJson(sqmRaw) as Record<string, unknown>;
    } catch {
      // Retry once with a stricter prompt (show Claude its bad output and ask to fix)
      try {
        const retryStart = Date.now();
        const retryRes = await anthropic.messages.create({
          model: extractionModel,
          max_tokens: 16384,
          system: prompts.sqmSystem,
          messages: [
            { role: "user", content: sqmContent },
            { role: "assistant", content: sqmRaw },
            { role: "user", content: STRICT_JSON_RETRY_MESSAGE },
          ],
        });
        logApiCall({
          call_type: "sqm_extraction",
          dossier_id: dossierId,
          model_used: extractionModel,
          tokens_input: retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms: Date.now() - retryStart,
          status: "success",
        });
        const retryRaw = retryRes.content[0].type === "text" ? retryRes.content[0].text : "";
        sqmExtraction = parseClaudeJson(retryRaw) as Record<string, unknown>;
      } catch {
        await setStatus(admin, dossierId, "error", {
          error_message: `SQM extraction returned invalid JSON. Raw response: ${sqmRaw.substring(0, 500)}`,
        });
        return NextResponse.json({ error: "SQM parse error" }, { status: 500 });
      }
    }

    // ── Apartment building detection ──────────────────────────────────────────
    const sqmSummary = (sqmExtraction.summary ?? {}) as Record<string, unknown>;
    const sqmBuildingPrimary = ((sqmExtraction.building_type ?? {}) as Record<string, unknown>).primary as string | undefined;
    const sqmApartmentCount = sqmSummary.apartment_count as number | null | undefined;
    const isApartmentBuilding =
      sqmBuildingPrimary === "apartment_building" ||
      (sqmApartmentCount != null && sqmApartmentCount > 1) ||
      dossier.building_type === "apartment_building";

    // ── Backfill flat columns from sqm_extraction if metadata extraction missed them ──
    {
      const backfill: Record<string, unknown> = {};
      const sqmLivable = sqmSummary.total_livable_sqm as number | null;
      const sqmReplacement =
        (sqmSummary.total_replacement_value_incl_vat_eur as number | null) ??
        (sqmSummary.total_replacement_value_eur as number | null);

      if (!dossier.building_type && sqmBuildingPrimary)
        backfill.building_type = sqmBuildingPrimary;
      if (!dossier.known_total_sqm && sqmLivable && sqmLivable > 0)
        backfill.known_total_sqm = sqmLivable;
      if (!dossier.known_total_price && sqmReplacement && sqmReplacement > 0)
        backfill.known_total_price = sqmReplacement;

      const effectivePrice = (backfill.known_total_price as number | undefined) ?? dossier.known_total_price;
      const effectiveSqm = (backfill.known_total_sqm as number | undefined) ?? dossier.known_total_sqm;
      if (!dossier.known_price_per_sqm && effectivePrice && effectiveSqm && effectiveSqm > 0)
        backfill.known_price_per_sqm = effectivePrice / effectiveSqm;

      if (Object.keys(backfill).length > 0) {
        await admin.from("reference_dossiers").update(backfill).eq("id", dossierId);
        Object.assign(dossier, backfill);
      }
    }

    if (isApartmentBuilding) {
      const aptCount = sqmApartmentCount ?? dossier.apartment_count ?? null;
      await admin
        .from("reference_dossiers")
        .update({
          building_type: "apartment_building",
          apartment_count: aptCount,
          sqm_extraction: sqmExtraction,
          processing_time_ms: Date.now() - startTime,
          status: "analyzed",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dossierId);
      return NextResponse.json({ success: true, status: "analyzed", apartment_building: true });
    }

    await setStatus(admin, dossierId, "sqm_done", { sqm_extraction: sqmExtraction });

    // ── QQP Extraction ────────────────────────────────────────────────────────
    const { data: qqpDefs } = await admin
      .from("qqp_definitions")
      .select("id, name, display_name, description, data_type, unit")
      .eq("is_active", true)
      .order("sort_order");

    await setStatus(admin, dossierId, "extracting_qqp");

    const qqpUserPrompt = buildQQPUserPrompt(
      sqmExtraction,
      qqpDefs ?? [],
      dossier.known_finishing_coefficient != null || dossier.known_price_per_sqm != null
        ? {
            knownPricePerSqm: dossier.known_price_per_sqm,
            knownCoefficient: dossier.known_finishing_coefficient,
            expertNotes: dossier.expert_notes,
          }
        : undefined,
      prompts.qqpUserTemplate
    );

    const qqpCallStart = Date.now();
    const qqpResponse = await anthropic.messages.create({
      model: qqpModel,
      max_tokens: 8192,
      system: prompts.qqpSystem,
      messages: [{ role: "user", content: qqpUserPrompt }],
    });
    logApiCall({
      call_type: "qqp_extraction",
      dossier_id: dossierId,
      model_used: qqpModel,
      tokens_input: qqpResponse.usage.input_tokens,
      tokens_output: qqpResponse.usage.output_tokens,
      duration_ms: Date.now() - qqpCallStart,
      status: "success",
    });

    const qqpRaw =
      qqpResponse.content[0].type === "text" ? qqpResponse.content[0].text : "";

    type QQPExtractionResult = {
      qqp_values: Record<
        string,
        { value: unknown; confidence: number; notes?: string }
      >;
      finishing_assessment: {
        level: string;
        coefficient: number;
        confidence: number;
        reasoning: string;
      };
      new_qqp_suggestions?: Array<{
        name: string;
        description: string;
        reasoning: string;
      }>;
    };

    let qqpExtraction: QQPExtractionResult;
    try {
      qqpExtraction = parseClaudeJson(qqpRaw) as QQPExtractionResult;
    } catch {
      try {
        const retryStart = Date.now();
        const retryRes = await anthropic.messages.create({
          model: qqpModel,
          max_tokens: 8192,
          system: prompts.qqpSystem,
          messages: [
            { role: "user", content: qqpUserPrompt },
            { role: "assistant", content: qqpRaw },
            { role: "user", content: STRICT_JSON_RETRY_MESSAGE },
          ],
        });
        logApiCall({
          call_type: "qqp_extraction",
          dossier_id: dossierId,
          model_used: qqpModel,
          tokens_input: retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms: Date.now() - retryStart,
          status: "success",
        });
        const retryRaw = retryRes.content[0].type === "text" ? retryRes.content[0].text : "";
        qqpExtraction = parseClaudeJson(retryRaw) as QQPExtractionResult;
      } catch {
        await setStatus(admin, dossierId, "error", {
          error_message: `QQP extraction returned invalid JSON. Raw response: ${qqpRaw.substring(0, 500)}`,
        });
        return NextResponse.json({ error: "QQP parse error" }, { status: 500 });
      }
    }

    const qqpDefMap = Object.fromEntries(
      (qqpDefs ?? []).map((d) => [d.name, d])
    );

    const qqpValueRows = Object.entries(qqpExtraction.qqp_values ?? {})
      .map(([name, data]) => {
        const def = qqpDefMap[name];
        if (!def) return null;
        const val = data.value;
        return {
          dossier_id: dossierId as string,
          qqp_id: def.id,
          value_numeric: typeof val === "number" ? val : null,
          value_boolean: typeof val === "boolean" ? val : null,
          value_text: typeof val === "string" ? val : null,
          confidence: data.confidence ?? 0.5,
          extraction_notes: data.notes ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (qqpValueRows.length > 0) {
      await admin
        .from("dossier_qqp_values")
        .upsert(qqpValueRows, { onConflict: "dossier_id,qqp_id" });
    }

    const predictedCoeff = qqpExtraction.finishing_assessment.coefficient;

    // ── Compute predicted total cost via Formula V2 ───────────────────────────
    const { data: postcodeRow } = await admin
      .from("postcode_prices")
      .select("base_price_per_sqm")
      .eq("postcode", dossier.postcode ?? "")
      .maybeSingle();

    const { data: abexRow } = await admin
      .from("abex_index")
      .select("index_value")
      .eq("year", abexYear)
      .eq("semester", abexSemester)
      .maybeSingle();

    const abexFactor = abexRow ? Number(abexRow.index_value) / 1000 : 1.0;
    const cat1AtF1 = interpolatePrice(1.0, pricing.cat1_min, pricing.cat1_max);
    const regionalFactor = postcodeRow
      ? Number(postcodeRow.base_price_per_sqm) / cat1AtF1
      : 1.0;

    const areas = categorizeAreas(sqmExtraction);
    const costBreakdown = calculateCost(areas, predictedCoeff, pricing, regionalFactor, abexFactor);
    const predictedTotalCost = costBreakdown.total_cost;
    const predictedFinishingLabel = costBreakdown.finishing_label;

    // ── prediction_error: percentage error on total cost ─────────────────────
    let predictionError: number | null = null;
    const knownTotalCost =
      dossier.known_total_price != null
        ? dossier.known_total_price
        : dossier.known_price_per_sqm != null && areas.cat1_sqm > 0
          ? dossier.known_price_per_sqm * areas.cat1_sqm
          : null;

    if (knownTotalCost != null && knownTotalCost > 0) {
      predictionError = (predictedTotalCost - knownTotalCost) / knownTotalCost;
    }

    await admin
      .from("reference_dossiers")
      .update({
        qqp_extraction: qqpExtraction,
        predicted_finishing_coefficient: predictedCoeff,
        predicted_finishing_level: predictedFinishingLabel,
        prediction_error: predictionError,
        processing_time_ms: Date.now() - startTime,
        status: "analyzed",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dossierId);

    // ── QQP Discovery ─────────────────────────────────────────────────────────
    const suggestions = qqpExtraction.new_qqp_suggestions ?? [];
    if (
      suggestions.length > 0 &&
      predictionError !== null &&
      Math.abs(predictionError) > residualTrigger
    ) {
      const discoveryRows = suggestions.map((s) => ({
        dossier_id: dossierId as string,
        proposed_name: s.name,
        proposed_description: s.description,
        reasoning: s.reasoning,
        prediction_residual: predictionError,
      }));
      await admin.from("qqp_discovery_log").insert(discoveryRows);
    }

    // ── Self-learning: evaluate discoveries & auto-calibrate ──────────────────
    try {
      await evaluateDiscoveries();
    } catch (e) {
      console.warn("[process-dossier] discovery evaluation failed (non-fatal)", e);
    }

    try {
      if (await shouldAutoCalibrate()) {
        await calibrateWeights();
        console.log("[process-dossier] Auto-calibration triggered and completed.");
      }
    } catch (e) {
      console.warn("[process-dossier] auto-calibration failed (non-fatal)", e);
    }

    return NextResponse.json({ success: true, status: "analyzed" });
  } catch (err) {
    console.error("[process-dossier]", err);
    const msg = err instanceof Error ? err.message : "Unexpected internal error";
    if (dossierId) {
      await admin
        .from("reference_dossiers")
        .update({
          status: "error",
          error_message: msg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dossierId);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
