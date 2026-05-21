import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SQM_SYSTEM_PROMPT, QQP_SYSTEM_PROMPT, QQP_USER_PROMPT_TEMPLATE } from "@/lib/ai/prompts";
import { migrateQQPValues } from "@/lib/qqp/data-migration";
import { calibrateWeights } from "@/lib/qqp/weight-calibration";

export const maxDuration = 300;

/**
 * One-shot migration endpoint for the QQP pipeline redesign.
 *
 * Steps:
 * 1. Seed initial prompt versions (SQM + QQP) if none exist
 * 2. Migrate old QQP values to -1/+1 score format
 * 3. Train first Ridge regression model
 *
 * Prerequisites: the SQL migration (20260521_prompt_versions_and_qqp_updates.sql)
 * must be applied to Supabase BEFORE calling this endpoint.
 *
 * This is idempotent — safe to call multiple times.
 */
export async function POST() {
  const admin = createSupabaseAdminClient();
  const log: string[] = [];

  try {
    // ── Step 1: Seed prompt versions ──────────────────────────────────────

    const { count: existingPrompts } = await admin
      .from("prompt_versions")
      .select("id", { count: "exact", head: true });

    if ((existingPrompts ?? 0) === 0) {
      // Seed SQM prompt v1
      await admin.from("prompt_versions").insert({
        prompt_type: "sqm_extraction",
        version_number: 1,
        system_prompt: SQM_SYSTEM_PROMPT,
        user_template: "Extract surface areas from the building plan images.",
        is_active: true,
        notes: "Initial SQM extraction prompt (v11b decision-tree measurement)",
      });
      log.push("Seeded SQM prompt version 1");

      // Seed QQP prompt v1
      await admin.from("prompt_versions").insert({
        prompt_type: "qqp_extraction",
        version_number: 1,
        system_prompt: QQP_SYSTEM_PROMPT,
        user_template: QQP_USER_PROMPT_TEMPLATE,
        is_active: true,
        notes: "Initial QQP extraction prompt with -1/+1 scoring scale",
      });
      log.push("Seeded QQP prompt version 1");
    } else {
      log.push(`Prompt versions already exist (${existingPrompts} rows), skipping seed`);
    }

    // ── Step 2: Migrate old QQP values ──────────────────────────────────

    let totalConverted = 0;
    let totalErrors = 0;
    let batch = 0;
    let hasMore = true;

    while (hasMore) {
      batch++;
      const result = await migrateQQPValues(200);
      totalConverted += result.converted;
      totalErrors += result.errors;
      log.push(`Migration batch ${batch}: ${result.processed} processed, ${result.converted} converted, ${result.errors} errors`);

      // If we processed fewer than batchSize, we're done
      if (result.processed < 200) {
        hasMore = false;
      }

      // Safety: max 50 batches (10,000 rows)
      if (batch >= 50) {
        log.push("Hit batch limit (50), stopping migration");
        hasMore = false;
      }
    }

    log.push(`Migration complete: ${totalConverted} converted, ${totalErrors} errors`);

    // ── Step 3: Train initial Ridge model ────────────────────────────────

    try {
      const calibration = await calibrateWeights();
      log.push(
        `Model v${calibration.version} trained: ${calibration.dossiersUsed} dossiers, ` +
        `MAE=${calibration.metrics.mae.toFixed(3)}, R²=${calibration.metrics.r_squared.toFixed(3)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      log.push(`Calibration skipped: ${msg}`);
      // Not fatal — model training requires enough dossiers
    }

    return NextResponse.json({
      success: true,
      steps: log,
      summary: {
        promptsSeeded: log.some((l) => l.includes("Seeded")),
        valuesConverted: totalConverted,
        conversionErrors: totalErrors,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Migration failed";
    console.error("[migrate-qqp-pipeline]", err);
    return NextResponse.json(
      { error: msg, steps: log },
      { status: 500 }
    );
  }
}
