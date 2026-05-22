import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Force Next.js to never cache this route — polling requires a fresh DB read
// on every request. Without this, the framework-level data cache serves the
// first response (status: "uploading") for all subsequent polls.
export const dynamic  = "force-dynamic";
export const revalidate = 0;

// Processing steps that can time out — if updated_at hasn't moved in 5 min,
// the background worker died without writing an error (e.g. a 504).
const INTERMEDIATE = new Set(["uploading", "extracting_sqm", "analyzing_qqp", "calculating"]);
const TIMEOUT_MS   = 5 * 60 * 1000;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = createSupabaseAdminClient();

  let tenantId: string | null = null;
  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: userRow } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    tenantId = userRow?.tenant_id ?? null;
    if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("estimations")
    .select([
      "id", "status", "error_message",
      "building_type", "total_livable_sqm", "total_gross_sqm",
      "finishing_level", "finishing_coefficient",
      "base_price_per_sqm", "abex_factor",
      "estimated_price_per_sqm", "estimated_total_cost",
      "sqm_confidence", "qqp_confidence", "overall_confidence",
      "sqm_extraction", "extracted_qqps",
      "sub_areas",
      "postcode", "plan_file_name",
      "processing_time_ms", "updated_at",
    ].join(", "))
    .eq("id", params.id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) {
    console.log("[estimate-status]", params.id, "→ not found");
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cast to a plain object so we can read/spread fields without fighting the
  // Supabase GenericStringError union type that appears when no codegen types
  // are configured.
  type Row = Record<string, unknown> & {
    status: string;
    error_message: string | null;
    updated_at: string | null;
  };
  const row = data as unknown as Row;

  // Timeout detection: if stuck on an intermediate status for > 5 min,
  // write the error to the DB so the polling client surfaces it immediately.
  let responseData: Row = row;

  if (INTERMEDIATE.has(row.status)) {
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const staleness = Date.now() - updatedAt;

    if (staleness > TIMEOUT_MS) {
      const timeoutMsg = `Processing timed out after ${Math.round(staleness / 60000)} min (stuck on "${row.status}").`;
      await admin
        .from("estimations")
        .update({
          status:        "error",
          error_message: timeoutMsg,
          updated_at:    new Date().toISOString(),
        })
        .eq("id", params.id);

      responseData = { ...row, status: "error", error_message: timeoutMsg };
      console.log("[estimate-status]", params.id, "→ timed out, was:", row.status);
    }
  }

  console.log("[estimate-status]", params.id, "→", responseData.status);

  return NextResponse.json(responseData, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
