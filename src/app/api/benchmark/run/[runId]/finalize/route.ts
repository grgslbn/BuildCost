// POST: compute aggregate metrics and finalize a benchmark run
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mae(values: (number | null)[]): number {
  const valid = values.filter((x): x is number => x != null);
  if (valid.length === 0) return 0;
  return valid.reduce((s, x) => s + Math.abs(x), 0) / valid.length;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const admin = createSupabaseAdminClient();

    // Get all results for this run
    const { data: results, error: resErr } = await admin
      .from("evaluation_results")
      .select("cost_error_pct, cat1_error_pct, cat2_error_pct, cat3_error_pct, f_error, error_message")
      .eq("run_id", params.runId);

    if (resErr) {
      return NextResponse.json({ error: resErr.message }, { status: 500 });
    }

    const all = results ?? [];
    const succeeded = all.filter((r) => !r.error_message);
    const costErrors = succeeded.map((r) => r.cost_error_pct).filter((v): v is number => v != null);
    const absCost = costErrors.map(Math.abs);
    const fErrors = succeeded.map((r) => r.f_error).filter((v): v is number => v != null).map(Math.abs);
    const total = costErrors.length || 1;

    const metrics = {
      cost_mae_pct: mae(costErrors),
      cost_median_pct: median(absCost),
      cost_worst_pct: absCost.length ? Math.max(...absCost) : 0,
      cost_within_10_pct: absCost.filter((e) => e <= 10).length / total,
      cost_within_15_pct: absCost.filter((e) => e <= 15).length / total,
      cat1_mae_pct: mae(succeeded.map((r) => r.cat1_error_pct)),
      cat2_mae_pct: mae(succeeded.map((r) => r.cat2_error_pct)),
      cat3_mae_pct: mae(succeeded.map((r) => r.cat3_error_pct)),
      f_mae: fErrors.length ? fErrors.reduce((s, v) => s + v, 0) / fErrors.length : 0,
      f_median: median(fErrors),
      dossiers_succeeded: succeeded.length,
      dossiers_failed: all.length - succeeded.length,
    };

    const { error: updateErr } = await admin
      .from("evaluation_runs")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        metrics,
      })
      .eq("id", params.runId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, metrics });
  } catch (err) {
    // Mark run as failed
    const admin = createSupabaseAdminClient();
    await admin
      .from("evaluation_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", params.runId);

    console.error("[benchmark/run/finalize]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
