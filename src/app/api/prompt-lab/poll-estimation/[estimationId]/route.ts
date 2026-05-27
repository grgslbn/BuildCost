// GET: check estimation status — used by the benchmark runner to poll until done
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Vercel Pro has a 300s function limit. If the estimate-process function is
// killed by Vercel before it can set an error status, the estimation gets
// stuck in a non-terminal state (e.g., "extracting_sqm"). We detect this by
// checking if the estimation has been running for longer than the Vercel
// function limit + buffer.
const STUCK_THRESHOLD_MS = 6 * 60 * 1000; // 6 minutes

export async function GET(
  _req: NextRequest,
  { params }: { params: { estimationId: string } },
) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("estimations")
    .select("status, error_message, created_at, sub_areas, sqm_extraction, finishing_coefficient, overall_confidence, processing_time_ms")
    .eq("id", params.estimationId)
    .single();

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const done = data.status === "complete" || data.status === "error";

  // Detect stuck estimations: if still running after 6 min, Vercel likely killed the function
  if (!done && data.created_at) {
    const age = Date.now() - new Date(data.created_at).getTime();
    if (age > STUCK_THRESHOLD_MS) {
      // Mark as error so it doesn't stay stuck forever
      await admin
        .from("estimations")
        .update({ status: "error", error_message: "Pipeline killed by Vercel (>300s function limit)" })
        .eq("id", params.estimationId);
      return NextResponse.json({ status: "error", done: true, stuck: true });
    }
  }

  if (done) {
    const sub = data.sub_areas as Record<string, number> | null;
    const sqm = data.sqm_extraction as Record<string, unknown> | null;
    const totals = sqm?.project_totals as Record<string, number> | undefined;
    const hasData = (totals?.total_cat1_sqm ?? sub?.cat1_sqm ?? 0) > 0 || (sub?.total_cost ?? 0) > 0;
    return NextResponse.json({
      status: data.status,
      done,
      error_message: data.error_message,
      ...(hasData ? {
        result: {
          cat1_sqm: totals?.total_cat1_sqm ?? sub?.cat1_sqm ?? 0,
          cat2_sqm: totals?.total_cat2_sqm ?? sub?.cat2_sqm ?? 0,
          cat3_sqm: totals?.total_cat3_sqm ?? sub?.cat3_sqm ?? 0,
          total_cost: sub?.total_cost ?? 0,
          finishing_coefficient: data.finishing_coefficient,
          confidence: data.overall_confidence,
          processing_time_ms: data.processing_time_ms,
          warnings: (sqm?.extraction_warnings as string[] | undefined) ?? [],
        },
      } : {}),
    });
  }

  return NextResponse.json({ status: data.status, done });
}
