// GET: check estimation status — used by the benchmark runner to poll until done
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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
    .select("status, error_message, created_at, updated_at, sub_areas, sqm_extraction, finishing_coefficient, overall_confidence, processing_time_ms")
    .eq("id", params.estimationId)
    .single();

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const done = data.status === "complete" || data.status === "error";

  // Detect stuck estimations: if status hasn't been updated in 6 min, the
  // function was likely killed (Vercel 300s limit) or the worker crashed.
  // Use updated_at (last status change) rather than created_at so that
  // queue-based processing (which may start seconds or minutes after
  // creation) is correctly tracked.
  if (!done && (data.updated_at || data.created_at)) {
    const lastActivity = new Date(data.updated_at || data.created_at).getTime();
    const age = Date.now() - lastActivity;
    if (age > STUCK_THRESHOLD_MS) {
      const totalAge = Date.now() - new Date(data.created_at).getTime();
      const stuckMsg = data.status === "uploading"
        ? "Pipeline never started (estimate-process was not triggered)"
        : `Pipeline killed by Vercel — stuck in "${data.status}" for >${Math.round(totalAge / 1000)}s`;
      // Mark as error so it doesn't stay stuck forever
      await admin
        .from("estimations")
        .update({ status: "error", error_message: stuckMsg })
        .eq("id", params.estimationId);
      return NextResponse.json({ status: "error", done: true, stuck: true, error_message: stuckMsg });
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
