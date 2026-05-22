// GET: check estimation status — used by the benchmark runner to poll until done
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

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
    .select("status, error_message, created_at")
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

  return NextResponse.json({ status: data.status, done });
}
