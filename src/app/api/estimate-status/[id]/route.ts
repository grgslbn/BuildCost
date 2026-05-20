import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
