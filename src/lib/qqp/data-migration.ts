/**
 * Programmatic conversion of old QQP values to new score format.
 *
 * Converts dossier_qqp_values rows from old value_boolean/value_numeric
 * to the new -1/+1 score format using reference ranges.
 *
 * Storage approach: reuses existing DB columns:
 * - value_numeric → stores the score (-1.0 to +1.0)
 * - confidence → stays as confidence (lowered for converted data)
 * - extraction_notes → stores the reasoning string
 * - value_boolean → set to null
 * - extraction_method → marks provenance
 */

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { convertToScore } from "./reference-ranges";

export type MigrationResult = {
  processed: number;
  converted: number;
  errors: number;
};

/**
 * Convert all existing dossier_qqp_values from old format to new score format.
 * Idempotent — only processes rows where extraction_method is null (unconverted).
 *
 * @param batchSize - Number of rows to process per call
 * @returns Counts of processed, converted, and errored rows
 */
export async function migrateQQPValues(
  batchSize = 100
): Promise<MigrationResult> {
  const admin = createSupabaseAdminClient();
  let processed = 0;
  let converted = 0;
  let errors = 0;

  // Load QQP definitions for name lookup
  const { data: defs } = await admin
    .from("qqp_definitions")
    .select("id, name, data_type");
  const defMap = new Map((defs ?? []).map((d) => [d.id, d]));

  // Load rows that haven't been converted yet.
  // After the ALTER TABLE migration, existing rows got DEFAULT 'ai_extracted'.
  // We identify unconverted rows by checking: extraction_method != 'programmatic_conversion'
  // AND value_numeric is outside -1/+1 range OR value_boolean is not null.
  const { data: rows } = await admin
    .from("dossier_qqp_values")
    .select("id, qqp_id, value_numeric, value_boolean, confidence")
    .neq("extraction_method", "programmatic_conversion")
    .or("value_boolean.not.is.null,value_numeric.gt.1.0,value_numeric.lt.-1.0")
    .limit(batchSize);

  for (const row of rows ?? []) {
    processed++;
    const def = defMap.get(row.qqp_id);
    if (!def) {
      errors++;
      continue;
    }

    // Determine old value: prefer numeric, then boolean
    const oldValue =
      row.value_numeric !== null
        ? Number(row.value_numeric)
        : row.value_boolean !== null
          ? row.value_boolean
          : null;

    const score = convertToScore(def.name, oldValue);

    const { error } = await admin
      .from("dossier_qqp_values")
      .update({
        value_numeric: score,
        value_boolean: null,
        value_text: null,
        // Lower confidence for programmatic conversion (max 0.5)
        confidence: Math.min(row.confidence ?? 0.5, 0.5),
        extraction_notes: `Programmatic conversion from ${def.data_type}: ${oldValue} → ${score.toFixed(3)}`,
        extraction_method: "programmatic_conversion",
      })
      .eq("id", row.id);

    if (error) errors++;
    else converted++;
  }

  return { processed, converted, errors };
}
