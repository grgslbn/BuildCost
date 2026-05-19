import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/ai/client";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  buildQQPUserPrompt,
  parseClaudeJson,
} from "@/lib/ai/prompts";

export const maxDuration = 60;

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
  try {
    const body = await req.json();
    const { dossierId } = body as { dossierId?: string };
    if (!dossierId) {
      return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createSupabaseAdminClient();

    const { data: userRow } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userRow?.tenant_id) {
      return NextResponse.json({ error: "No tenant" }, { status: 403 });
    }

    const { data: dossier, error: dossierError } = await admin
      .from("reference_dossiers")
      .select("*")
      .eq("id", dossierId)
      .eq("tenant_id", userRow.tenant_id)
      .single();

    if (dossierError || !dossier) {
      return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
    }

    if (dossier.plan_file_type === "pdf") {
      await setStatus(admin, dossierId, "error", {
        error_message:
          "PDF processing not yet supported. Please upload a PNG or JPG image.",
      });
      return NextResponse.json({ error: "PDF not yet supported" }, { status: 422 });
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
        "qqp_discovery_threshold",
      ]);

    const settings = Object.fromEntries(
      (settingsRows ?? []).map((s) => [s.key, s.value])
    );
    const extractionModel =
      (settings.extraction_model as string) ?? "claude-sonnet-4-20250514";
    const qqpModel =
      (settings.qqp_model as string) ?? "claude-sonnet-4-20250514";
    const residualTrigger = (settings.qqp_residual_trigger as number) ?? 0.15;

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
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mediaType = getImageMediaType(dossier.plan_file_name ?? "plan.jpg");

    // ── SQM Extraction ────────────────────────────────────────────────────────
    await setStatus(admin, dossierId, "extracting_sqm", { error_message: null });

    const sqmResponse = await anthropic.messages.create({
      model: extractionModel,
      max_tokens: 4096,
      system: SQM_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: SQM_USER_PROMPT },
          ],
        },
      ],
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
      dossier.known_finishing_coefficient != null
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

    // Build name→def map (with id)
    const qqpDefMap = Object.fromEntries(
      (qqpDefs ?? []).map((d) => [d.name, d])
    );

    // Upsert dossier_qqp_values
    const qqpValueRows = Object.entries(qqpExtraction.qqp_values ?? {})
      .map(([name, data]) => {
        const def = qqpDefMap[name];
        if (!def) return null;
        const val = data.value;
        return {
          dossier_id: dossierId,
          qqp_id: def.id,
          value_numeric: typeof val === "number" ? val : null,
          value_boolean: typeof val === "boolean" ? val : null,
          value_text: typeof val === "string" ? val : null,
          confidence: data.confidence ?? 0.5,
          extraction_notes: data.notes ?? null,
        };
      })
      .filter(
        (r): r is NonNullable<typeof r> => r !== null
      );

    if (qqpValueRows.length > 0) {
      await admin
        .from("dossier_qqp_values")
        .upsert(qqpValueRows, { onConflict: "dossier_id,qqp_id" });
    }

    const predictedCoeff = qqpExtraction.finishing_assessment.coefficient;
    const predictionError =
      dossier.known_finishing_coefficient != null
        ? predictedCoeff - dossier.known_finishing_coefficient
        : null;

    await admin
      .from("reference_dossiers")
      .update({
        qqp_extraction: qqpExtraction,
        predicted_finishing_coefficient: predictedCoeff,
        prediction_error: predictionError,
        status: "analyzed",
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
        dossier_id: dossierId,
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
