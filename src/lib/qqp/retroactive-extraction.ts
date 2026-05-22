import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/ai/client";
import { parseClaudeJson } from "@/lib/ai/prompts";
import { QQP_REFERENCE_RANGES } from "./reference-ranges";

type QQPDef = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  data_type: string;
  unit: string | null;
};

type ExtractionValue = {
  score: number | null;
  confidence: number;
  reasoning?: string;
};

const RETROACTIVE_PROMPT = (def: QQPDef, planData: Record<string, unknown>) => {
  const range = QQP_REFERENCE_RANGES[def.name];
  const guide = range?.promptGuide ?? "Use your judgment. 0.0 = average Belgian new build.";
  return `You are analyzing structured data extracted from a building plan.

Given the plan data below, score this specific parameter on a -1.0 to +1.0 scale.

SCORING SCALE:
  -1.0 = Actively basic/cheap
   0.0 = Average Belgian new build
  +1.0 = Luxury / premium

PLAN DATA:
${JSON.stringify(planData, null, 2)}

PARAMETER TO SCORE:
- Name: ${def.name}
- Description: ${def.description ?? def.display_name}
- Scoring reference: ${guide}

Rules:
- Score MUST be between -1.0 and +1.0
- Look for NEGATIVE signals (missing expected features → score below 0)
- Be conservative: if you cannot determine the score, return null
- Keep reasoning brief (max 100 chars)

Return ONLY valid JSON:
{"score": <number -1.0 to 1.0 or null>, "confidence": <0.0 to 1.0>, "reasoning": "brief explanation"}

No markdown, no other text.`;
};

/**
 * Extracts a single QQP value for a single dossier using its stored sqm_extraction.
 * Returns the inserted/updated value or null if extraction failed.
 */
async function extractOneQQP(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  dossierId: string,
  sqmExtraction: Record<string, unknown>,
  def: QQPDef,
  model: string
): Promise<boolean> {
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 256,
      messages: [
        { role: "user", content: RETROACTIVE_PROMPT(def, sqmExtraction) },
      ],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed = parseClaudeJson(raw) as ExtractionValue;

    if (parsed.score === null || parsed.score === undefined) return false;

    const row = {
      dossier_id: dossierId,
      qqp_id: def.id,
      value_numeric: parsed.score,
      value_boolean: null,
      value_text: null,
      confidence: parsed.confidence ?? 0.5,
      extraction_notes: parsed.reasoning ?? null,
      extraction_method: "ai_extracted" as const,
    };

    await admin
      .from("dossier_qqp_values")
      .upsert(row, { onConflict: "dossier_id,qqp_id" });

    return true;
  } catch {
    return false;
  }
}

export type RetroactiveExtractionResult = {
  processed: number;
  succeeded: number;
  remaining: number;
  total: number;
};

/**
 * Runs retroactive extraction for a specific QQP across all analyzed dossiers
 * that don't already have a value for it.
 * Processes up to `batchSize` dossiers per call — designed to be called
 * repeatedly until `remaining` reaches 0.
 */
export async function retroactiveExtractForQQP(
  qqpId: string,
  batchSize = 20
): Promise<RetroactiveExtractionResult> {
  const admin = createSupabaseAdminClient();

  // Load the QQP definition
  const { data: def } = await admin
    .from("qqp_definitions")
    .select("id, name, display_name, description, data_type, unit")
    .eq("id", qqpId)
    .single();

  if (!def) return { processed: 0, succeeded: 0, remaining: 0, total: 0 };

  // Get extraction model
  const { data: modelRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "qqp_model")
    .single();
  const model = (modelRow?.value as string) ?? "claude-sonnet-4-6";

  // Find analyzed dossiers that already have this QQP value
  const { data: existing } = await admin
    .from("dossier_qqp_values")
    .select("dossier_id")
    .eq("qqp_id", qqpId);
  const existingIds = new Set((existing ?? []).map((r) => r.dossier_id));

  // Load all analyzed dossiers with sqm_extraction
  const { data: dossiers, count } = await admin
    .from("reference_dossiers")
    .select("id, sqm_extraction", { count: "exact" })
    .eq("status", "analyzed")
    .not("sqm_extraction", "is", null);

  const allDossiers = (dossiers ?? []).filter(
    (d) => !existingIds.has(d.id)
  );
  const total = count ?? 0;
  const remaining = allDossiers.length;

  const batch = allDossiers.slice(0, batchSize);

  let succeeded = 0;
  for (const dossier of batch) {
    const ok = await extractOneQQP(
      admin,
      dossier.id,
      dossier.sqm_extraction as Record<string, unknown>,
      def,
      model
    );
    if (ok) succeeded++;
  }

  return {
    processed: batch.length,
    succeeded,
    remaining: remaining - batch.length,
    total,
  };
}

/**
 * Re-extracts ALL QQP values for all analyzed dossiers, replacing existing values.
 * Processes up to batchSize dossiers per call. Used after prompt changes.
 */
export async function reExtractAllDossiers(
  batchSize = 10,
  offset = 0
): Promise<{ processed: number; remaining: number; total: number }> {
  const admin = createSupabaseAdminClient();

  const { data: modelRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "qqp_model")
    .single();
  const model = (modelRow?.value as string) ?? "claude-sonnet-4-6";

  const { data: qqpDefs } = await admin
    .from("qqp_definitions")
    .select("id, name, display_name, description, data_type, unit")
    .eq("is_active", true)
    .order("sort_order");

  const defs = qqpDefs ?? [];
  if (defs.length === 0) return { processed: 0, remaining: 0, total: 0 };

  const { data: dossiers, count } = await admin
    .from("reference_dossiers")
    .select("id, sqm_extraction", { count: "exact" })
    .eq("status", "analyzed")
    .not("sqm_extraction", "is", null)
    .range(offset, offset + batchSize - 1);

  const total = count ?? 0;
  const batch = dossiers ?? [];

  for (const dossier of batch) {
    for (const def of defs) {
      await extractOneQQP(
        admin,
        dossier.id,
        dossier.sqm_extraction as Record<string, unknown>,
        def,
        model
      );
    }
  }

  return {
    processed: batch.length,
    remaining: Math.max(0, total - offset - batch.length),
    total,
  };
}
