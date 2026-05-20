import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { anthropic } from "@/lib/ai/client";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  buildQQPUserPrompt,
  parseClaudeJson,
  STRICT_JSON_RETRY_MESSAGE,
} from "@/lib/ai/prompts";
import { splitPdfPages } from "@/lib/pdf/split-pages";
import { classifyPages } from "@/lib/pdf/classify-pages";
import { applyModelWeights, flattenQQPValues } from "@/lib/qqp/model-prediction";
import { logApiCall } from "@/lib/ai/log-api-call";
import { categorizeAreas } from "@/lib/cost/area-categories";
import { calculateCost, interpolatePrice, type PricingConfig } from "@/lib/cost/calculate-cost";
import type Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

function getImageMediaType(name: string): "image/jpeg" | "image/png" | "image/webp" {
  const l = name.toLowerCase();
  if (l.endsWith(".png")) return "image/png";
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

    if (!SKIP_AUTH) {
      const supabase = createSupabaseServerClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
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

    // Load settings
    const { data: settingsRows } = await admin
      .from("system_settings")
      .select("key, value")
      .in("key", [
        "extraction_model", "qqp_model",
        "cat1_price_min", "cat1_price_max",
        "cat2_price_min", "cat2_price_max",
        "cat3_price_min", "cat3_price_max",
        "abex_reference_year", "abex_reference_semester",
      ]);
    const settings = Object.fromEntries((settingsRows ?? []).map((s) => [s.key, s.value]));

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

    // Download file
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

    // ── Build SQM content ────────────────────────────────────────────────────
    await setStatus(admin, estimationId, "extracting_sqm");

    let sqmContent: Anthropic.MessageParam["content"];
    const isPdf = est.plan_storage_path.toLowerCase().endsWith(".pdf") ||
      (est.plan_file_name ?? "").toLowerCase().endsWith(".pdf");

    if (isPdf) {
      const { pages } = await splitPdfPages(Buffer.from(arrayBuffer), 40);
      const classifyStart = Date.now();
      const classifications = await classifyPages(pages, extractionModel);
      logApiCall({
        call_type: "page_classification",
        estimation_id: estimationId,
        model_used: extractionModel,
        duration_ms: Date.now() - classifyStart,
        status: "success",
      });
      const floorPlanNums = new Set(
        classifications.filter((c) => c.type === "floor_plan").map((c) => c.pageNumber)
      );
      const planPages = floorPlanNums.size > 0
        ? pages.filter((p) => floorPlanNums.has(p.pageNumber))
        : pages;

      sqmContent = [
        ...planPages.map((p): Anthropic.DocumentBlockParam => ({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: p.base64 },
        })),
        { type: "text", text: SQM_USER_PROMPT },
      ];
    } else {
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const mediaType = getImageMediaType(est.plan_file_name ?? "plan.jpg");
      sqmContent = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: SQM_USER_PROMPT },
      ];
    }

    // ── SQM extraction ────────────────────────────────────────────────────────
    const sqmCallStart = Date.now();
    const sqmResponse = await anthropic.messages.create({
      model: extractionModel,
      max_tokens: 16384,
      system: SQM_SYSTEM_PROMPT,
      messages: [{ role: "user", content: sqmContent }],
    });
    logApiCall({
      call_type: "sqm_extraction",
      estimation_id: estimationId,
      model_used: extractionModel,
      tokens_input: sqmResponse.usage.input_tokens,
      tokens_output: sqmResponse.usage.output_tokens,
      duration_ms: Date.now() - sqmCallStart,
      status: "success",
    });

    const sqmRaw = sqmResponse.content[0].type === "text" ? sqmResponse.content[0].text : "";
    let sqmExtraction: Record<string, unknown>;
    try {
      sqmExtraction = parseClaudeJson(sqmRaw) as Record<string, unknown>;
    } catch {
      try {
        const retryStart = Date.now();
        const retryRes = await anthropic.messages.create({
          model: extractionModel,
          max_tokens: 16384,
          system: SQM_SYSTEM_PROMPT,
          messages: [
            { role: "user", content: sqmContent },
            { role: "assistant", content: sqmRaw },
            { role: "user", content: STRICT_JSON_RETRY_MESSAGE },
          ],
        });
        logApiCall({
          call_type: "sqm_extraction",
          estimation_id: estimationId,
          model_used: extractionModel,
          tokens_input: retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms: Date.now() - retryStart,
          status: "success",
        });
        const retryRaw = retryRes.content[0].type === "text" ? retryRes.content[0].text : "";
        sqmExtraction = parseClaudeJson(retryRaw) as Record<string, unknown>;
      } catch {
        await setStatus(admin, estimationId, "error", {
          error_message: `SQM extraction returned invalid JSON. Raw response: ${sqmRaw.substring(0, 500)}`,
        });
        return NextResponse.json({ error: "SQM parse error" }, { status: 500 });
      }
    }

    const sqmSummary = (sqmExtraction.summary ?? {}) as Record<string, unknown>;
    const totalLivableSqm = (sqmSummary.total_livable_sqm as number) ?? null;
    const totalGrossSqm = (sqmSummary.total_gross_sqm as number) ?? null;
    const sqmBuildingType = ((sqmExtraction.building_type ?? {}) as Record<string, unknown>).primary as string | null;

    const floors = (sqmExtraction.floors as Array<{ rooms: Array<{ confidence: number }> }>) ?? [];
    const allRoomConfs = floors.flatMap((f) => (f.rooms ?? []).map((r) => r.confidence ?? 0.7));
    const sqmConfidence = allRoomConfs.length > 0
      ? allRoomConfs.reduce((a, b) => a + b, 0) / allRoomConfs.length
      : 0.7;

    // ── QQP extraction ────────────────────────────────────────────────────────
    await setStatus(admin, estimationId, "analyzing_qqp");

    const { data: qqpDefs } = await admin
      .from("qqp_definitions")
      .select("id, name, display_name, description, data_type, unit")
      .eq("is_active", true)
      .order("sort_order");

    const qqpUserPrompt = buildQQPUserPrompt(sqmExtraction, qqpDefs ?? []);
    const qqpCallStart = Date.now();
    const qqpResponse = await anthropic.messages.create({
      model: qqpModel,
      max_tokens: 8192,
      system: QQP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: qqpUserPrompt }],
    });
    logApiCall({
      call_type: "qqp_extraction",
      estimation_id: estimationId,
      model_used: qqpModel,
      tokens_input: qqpResponse.usage.input_tokens,
      tokens_output: qqpResponse.usage.output_tokens,
      duration_ms: Date.now() - qqpCallStart,
      status: "success",
    });

    const qqpRaw = qqpResponse.content[0].type === "text" ? qqpResponse.content[0].text : "";
    type QQPResult = {
      qqp_values: Record<string, { value: unknown; confidence: number; notes?: string }>;
      finishing_assessment: {
        level: string;
        coefficient: number;
        confidence: number;
        reasoning: string;
        strongest_indicators?: string[];
        weakest_indicators?: string[];
      };
    };

    let qqpExtraction: QQPResult;
    try {
      qqpExtraction = parseClaudeJson(qqpRaw) as QQPResult;
    } catch {
      try {
        const retryStart = Date.now();
        const retryRes = await anthropic.messages.create({
          model: qqpModel,
          max_tokens: 8192,
          system: QQP_SYSTEM_PROMPT,
          messages: [
            { role: "user", content: qqpUserPrompt },
            { role: "assistant", content: qqpRaw },
            { role: "user", content: STRICT_JSON_RETRY_MESSAGE },
          ],
        });
        logApiCall({
          call_type: "qqp_extraction",
          estimation_id: estimationId,
          model_used: qqpModel,
          tokens_input: retryRes.usage.input_tokens,
          tokens_output: retryRes.usage.output_tokens,
          duration_ms: Date.now() - retryStart,
          status: "success",
        });
        const retryRaw = retryRes.content[0].type === "text" ? retryRes.content[0].text : "";
        qqpExtraction = parseClaudeJson(retryRaw) as QQPResult;
      } catch {
        await setStatus(admin, estimationId, "error", {
          error_message: `QQP extraction returned invalid JSON. Raw response: ${qqpRaw.substring(0, 500)}`,
        });
        return NextResponse.json({ error: "QQP parse error" }, { status: 500 });
      }
    }

    // ── Finishing coefficient: model weights or Claude direct ─────────────────
    await setStatus(admin, estimationId, "calculating");

    let finishingCoefficient = qqpExtraction.finishing_assessment.coefficient;
    let modelVersionId: string | null = null;

    const { data: activeModel } = await admin
      .from("qqp_model_versions")
      .select("id, weights")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeModel?.weights) {
      const flatValues = flattenQQPValues(qqpExtraction.qqp_values);
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

    // Regional factor: postcode price relative to national CAT1 at F=1.0
    const cat1AtF1 = interpolatePrice(1.0, pricing.cat1_min, pricing.cat1_max);
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

    // ── Area categorization & cost calculation ────────────────────────────────
    const areas = categorizeAreas(sqmExtraction);
    const costBreakdown = calculateCost(areas, finishingCoefficient, pricing, regionalFactor, abexFactor);

    const qqpConfidence = qqpExtraction.finishing_assessment.confidence ?? 0.7;
    const overallConfidence = (sqmConfidence + qqpConfidence) / 2;

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
        base_price_per_sqm: postcodeRow ? Number(postcodeRow.base_price_per_sqm) : cat1AtF1,
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
        postcode: est.postcode,
      })
      .eq("id", estimationId);

    return NextResponse.json({ success: true, estimationId });
  } catch (err) {
    console.error("[estimate]", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    if (estimationId) {
      await admin
        .from("estimations")
        .update({ status: "error", error_message: msg, updated_at: new Date().toISOString() })
        .eq("id", estimationId);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
