import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { SKIP_AUTH } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

async function checkAdmin() {
  if (SKIP_AUTH) return true;
  const session = await getSessionWithRole();
  return session?.isAdmin ?? false;
}

// ── POST — reset a row so the pipeline can be re-fired ───────────────────────
export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { action, estimationId, dossierId } = (await req.json()) as {
    action: "reset_estimation" | "reset_dossier";
    estimationId?: string;
    dossierId?: string;
  };

  const admin = createSupabaseAdminClient();

  if (action === "reset_estimation") {
    if (!estimationId) return NextResponse.json({ error: "estimationId required" }, { status: 400 });
    const { error } = await admin
      .from("estimations")
      .update({
        status: "uploading",
        error_message: null,
        building_type: null,
        total_livable_sqm: null,
        total_gross_sqm: null,
        finishing_level: null,
        finishing_coefficient: null,
        estimated_total_cost: null,
        estimated_price_per_sqm: null,
        sqm_extraction: null,
        extracted_qqps: null,
        sub_areas: null,
        processing_time_ms: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", estimationId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, estimationId });
  }

  if (action === "reset_dossier") {
    if (!dossierId) return NextResponse.json({ error: "dossierId required" }, { status: 400 });
    const { error } = await admin
      .from("reference_dossiers")
      .update({
        status: "pending",
        error_message: null,
        sqm_extraction: null,
        qqp_extraction: null,
        predicted_finishing_coefficient: null,
        prediction_error: null,
        processing_time_ms: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dossierId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, dossierId });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// ── GET — lightweight status poll ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const id   = searchParams.get("id");

  if (!type || !id) {
    return NextResponse.json({ error: "type and id required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  if (type === "estimation") {
    const { data, error } = await admin
      .from("estimations")
      .select(
        "id, status, error_message, building_type, total_livable_sqm, " +
        "total_gross_sqm, finishing_level, finishing_coefficient, " +
        "estimated_total_cost, sqm_confidence, qqp_confidence, " +
        "overall_confidence, processing_time_ms, progress_detail, updated_at"
      )
      .eq("id", id)
      .single();
    if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  if (type === "dossier") {
    const { data, error } = await admin
      .from("reference_dossiers")
      .select(
        "id, status, error_message, plan_file_name, postcode, " +
        "predicted_finishing_coefficient, prediction_error, " +
        "processing_time_ms, updated_at"
      )
      .eq("id", id)
      .single();
    if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ error: "type must be estimation or dossier" }, { status: 400 });
}
