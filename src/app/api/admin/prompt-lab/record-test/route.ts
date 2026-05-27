import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/prompt-lab/record-test
 * Records a manual test result for a dossier. Creates/finds a "Manual Tests" run.
 * Body: { dossierId, estimationId }
 */

function computeErrorPct(predicted: number | null, expert: number | null): number | null {
  if (predicted == null || expert == null || expert === 0) return null;
  return ((predicted - expert) / expert) * 100;
}

async function getOrCreateManualRun(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<string> {
  // Find existing "Manual Tests" run
  const { data: existing } = await admin
    .from("evaluation_runs")
    .select("id")
    .eq("name", "Manual Tests")
    .eq("status", "running")
    .maybeSingle();

  if (existing) return existing.id;

  // Create new one
  const { data: newRun, error } = await admin
    .from("evaluation_runs")
    .insert({
      name: "Manual Tests",
      status: "running",
      dossier_count: 0,
      prompt_version_id: null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Create manual run: ${error.message}`);
  return newRun.id;
}

export async function POST(req: NextRequest) {
  try {
    const { dossierId, estimationId } = (await req.json()) as {
      dossierId: string;
      estimationId: string;
    };

    if (!dossierId || !estimationId) {
      return NextResponse.json({ error: "Missing dossierId or estimationId" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Read completed estimation
    const { data: result } = await admin
      .from("estimations")
      .select("status, estimated_total_cost, sqm_extraction, extracted_qqps, finishing_coefficient, sub_areas, processing_time_ms, error_message")
      .eq("id", estimationId)
      .single();

    if (!result) {
      return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
    }

    const runId = await getOrCreateManualRun(admin);

    if (result.status === "error") {
      await admin.from("evaluation_results").insert({
        run_id: runId,
        dossier_id: dossierId,
        error_message: (result.error_message as string | null)?.slice(0, 500) ?? "Pipeline error",
      });
      return NextResponse.json({ success: false, error: result.error_message });
    }

    // Load ground truth
    const { data: gt } = await admin
      .from("benchmark_ground_truth")
      .select("*")
      .eq("dossier_id", dossierId)
      .maybeSingle();

    // Extract pipeline values
    const subAreas = result.sub_areas as Record<string, number> | null;
    const extractedCat1 = subAreas?.cat1_sqm ?? null;
    const extractedCat2 = subAreas?.cat2_sqm ?? null;
    const extractedCat3 = subAreas?.cat3_sqm ?? null;
    const predictedCost = result.estimated_total_cost as number | null;
    const predictedF = result.finishing_coefficient as number | null;

    // Compute errors (only if GT exists)
    const cat1Err = gt ? computeErrorPct(extractedCat1, gt.expert_cat1_sqm) : null;
    const cat2Err = gt ? computeErrorPct(extractedCat2, gt.expert_cat2_sqm) : null;
    const cat3Err = gt ? computeErrorPct(extractedCat3, gt.expert_cat3_sqm) : null;
    const costErr = gt ? computeErrorPct(predictedCost, gt.expert_total_price) : null;

    const expertF = gt?.expert_finishing_level ? null : null; // TODO: back-calculate if needed
    const fErr = predictedF != null && expertF != null ? predictedF - expertF : null;

    // Delete previous manual test result for this dossier (keep only latest)
    await admin
      .from("evaluation_results")
      .delete()
      .eq("run_id", runId)
      .eq("dossier_id", dossierId);

    // Insert evaluation result
    const { error: insertErr } = await admin.from("evaluation_results").insert({
      run_id: runId,
      dossier_id: dossierId,
      extracted_cat1_sqm: extractedCat1,
      extracted_cat2_sqm: extractedCat2,
      extracted_cat3_sqm: extractedCat3,
      sqm_extraction: result.sqm_extraction,
      cat1_error_pct: cat1Err,
      cat2_error_pct: cat2Err,
      cat3_error_pct: cat3Err,
      extracted_qqps: result.extracted_qqps,
      predicted_f: predictedF,
      expert_f: expertF,
      f_error: fErr,
      predicted_total_cost: predictedCost,
      cost_error_pct: costErr,
      processing_time_ms: result.processing_time_ms,
      error_message: null,
    });

    if (insertErr) {
      return NextResponse.json({ error: `Insert result: ${insertErr.message}` }, { status: 500 });
    }

    // Update dossier count on the run
    const { count } = await admin
      .from("evaluation_results")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId);
    await admin
      .from("evaluation_runs")
      .update({ dossier_count: count ?? 0 })
      .eq("id", runId);

    return NextResponse.json({
      success: true,
      runId,
      costErrorPct: costErr,
      cat1ErrorPct: cat1Err,
      cat2ErrorPct: cat2Err,
      cat3ErrorPct: cat3Err,
    });
  } catch (err) {
    console.error("[record-test]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
