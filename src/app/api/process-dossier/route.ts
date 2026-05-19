import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { anthropic } from "@/lib/ai/client";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  buildQQPUserPrompt,
  parseClaudeJson,
} from "@/lib/ai/prompts";
import { splitPdfPages } from "@/lib/pdf/split-pages";
import { classifyPages } from "@/lib/pdf/classify-pages";
import { extractMetadata } from "@/lib/pdf/extract-metadata";
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

    // Load settings
    const { data: settingsRows } = await admin
      .from("system_settings")
      .select("key, value")
      .in("key", [
        "extraction_model",
        "qqp_model",
        "qqp_residual_trigger",
        "national_base_price_sqm",
      ]);

    const settings = Object.fromEntries(
      (settingsRows ?? []).map((s) => [s.key, s.value])
    );
    const extractionModel =
      (settings.extraction_model as string) ?? "claude-sonnet-4-20250514";
    const qqpModel =
      (settings.qqp_model as string) ?? "claude-sonnet-4-20250514";
    const residualTrigger = 0.15;
    const nationalBasePriceSqm = (settings.national_base_price_sqm as number) ?? 1450;

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
        effectiveClassifications = await classifyPages(pages, extractionModel);
        await admin
          .from("reference_dossiers")
          .update({ page_classifications: effectiveClassifications })
          .eq("id", dossierId);
      }

      // ── Step B: Extract metadata from expert_report / pricing_table pages ──
      let extractedMeta = null;
      try {
        extractedMeta = await extractMetadata(pages, effectiveClassifications, extractionModel);
      } catch {
        // Non-fatal — metadata extraction failure doesn't block plan processing
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
        { type: "text", text: SQM_USER_PROMPT },
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
        { type: "text", text: SQM_USER_PROMPT },
      ];
    }

    // ── SQM Extraction ────────────────────────────────────────────────────────
    await setStatus(admin, dossierId, "extracting_sqm", { error_message: null });

    const sqmResponse = await anthropic.messages.create({
      model: extractionModel,
      max_tokens: 4096,
      system: SQM_SYSTEM_PROMPT,
      messages: [{ role: "user", content: sqmContent }],
    });

    const sqmRaw =
      sqmResponse.content[0].type === "text" ? sqmResponse.content[0].text : "";

    let sqmExtraction: Record<string, unknown>;
    try {
      sqmExtraction = parseClaudeJson(sqmRaw) as Record<string, unknown>;
    } catch {
      await setStatus(admin, dossierId, "error", {
        error_message: "SQM extraction returned invalid JSON.",
      });
      return NextResponse.json({ error: "SQM parse error" }, { status: 500 });
    }

    // ── Apartment building detection ──────────────────────────────────────────
    const sqmSummary = (sqmExtraction.summary ?? {}) as Record<string, unknown>;
    const sqmBuildingPrimary = ((sqmExtraction.building_type ?? {}) as Record<string, unknown>).primary as string | undefined;
    const sqmApartmentCount = sqmSummary.apartment_count as number | null | undefined;
    const isApartmentBuilding =
      sqmBuildingPrimary === "apartment_building" ||
      (sqmApartmentCount != null && sqmApartmentCount > 1) ||
      dossier.building_type === "apartment_building";

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
        : undefined
    );

    const qqpResponse = await anthropic.messages.create({
      model: qqpModel,
      max_tokens: 4096,
      system: QQP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: qqpUserPrompt }],
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
      await setStatus(admin, dossierId, "error", {
        error_message: "QQP extraction returned invalid JSON.",
      });
      return NextResponse.json({ error: "QQP parse error" }, { status: 500 });
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

    // ── prediction_error: prefer explicit known coefficient, fall back to
    //    deriving an effective coefficient from known_price_per_sqm ──────────
    let predictionError: number | null = null;
    if (dossier.known_finishing_coefficient != null) {
      predictionError = predictedCoeff - dossier.known_finishing_coefficient;
    } else if (dossier.known_price_per_sqm != null && nationalBasePriceSqm > 0) {
      const effectiveCoeff = dossier.known_price_per_sqm / nationalBasePriceSqm;
      predictionError = predictedCoeff - effectiveCoeff;
    }

    await admin
      .from("reference_dossiers")
      .update({
        qqp_extraction: qqpExtraction,
        predicted_finishing_coefficient: predictedCoeff,
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
