import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";

// Thin gate: validates auth + row, kicks off /api/estimate-process in the
// background, and returns 200 immediately so the client can start polling.
// All heavy AI work lives in /api/estimate-process (maxDuration = 300).

export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  try {
    const body = await req.json() as { estimationId?: string };
    const estimationId = body.estimationId;
    if (!estimationId) {
      return NextResponse.json({ error: "Missing estimationId" }, { status: 400 });
    }

    if (!SKIP_AUTH) {
      const supabase = createSupabaseServerClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Verify the row exists and has a storage path before kicking off processing
    const { data: est, error: estError } = await admin
      .from("estimations")
      .select("id, plan_storage_path")
      .eq("id", estimationId)
      .single();

    if (estError || !est) {
      return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
    }

    if (!est.plan_storage_path) {
      await admin
        .from("estimations")
        .update({
          status:        "error",
          error_message: "No plan file attached.",
          updated_at:    new Date().toISOString(),
        })
        .eq("id", estimationId);
      return NextResponse.json({ error: "No plan file" }, { status: 422 });
    }

    // Fire /api/estimate-process without awaiting — it runs as a separate
    // Vercel function instance and updates the DB status as it progresses.
    const origin = new URL(req.url).origin;
    fetch(`${origin}/api/estimate-process`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ estimationId }),
    }).catch((err) => {
      console.error("[estimate] failed to kick off estimate-process:", err);
    });

    return NextResponse.json({ estimationId });
  } catch (err) {
    console.error("[estimate]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
