import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";

// Fast gate: validates auth + confirms the estimation row has a storage path,
// then returns the estimationId. The client is responsible for firing
// /api/estimate-process directly (without awaiting) — that route holds the
// connection open for up to 300s and updates DB status as it progresses.

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

    // Verify the row exists and has a storage path
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

    return NextResponse.json({ estimationId });
  } catch (err) {
    console.error("[estimate]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
