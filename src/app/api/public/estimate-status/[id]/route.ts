import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { PUBLIC_TENANT_ID } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTERMEDIATE = new Set([
  "uploading",
  "extracting_sqm",
  "analyzing_qqp",
  "calculating",
]);
const TIMEOUT_MS = 5 * 60 * 1000;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("estimations")
    .select(
      [
        "id",
        "status",
        "error_message",
        "building_type",
        "total_livable_sqm",
        "total_gross_sqm",
        "finishing_level",
        "finishing_coefficient",
        "base_price_per_sqm",
        "abex_factor",
        "estimated_price_per_sqm",
        "estimated_total_cost",
        "sqm_confidence",
        "qqp_confidence",
        "overall_confidence",
        "sqm_extraction",
        "extracted_qqps",
        "sub_areas",
        "postcode",
        "plan_file_name",
        "processing_time_ms",
        "updated_at",
      ].join(", ")
    )
    .eq("id", params.id)
    .eq("tenant_id", PUBLIC_TENANT_ID)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  type Row = Record<string, unknown> & {
    status: string;
    error_message: string | null;
    updated_at: string | null;
  };
  const row = data as unknown as Row;
  let responseData: Row = row;

  if (INTERMEDIATE.has(row.status)) {
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const staleness = Date.now() - updatedAt;
    if (staleness > TIMEOUT_MS) {
      const timeoutMsg = `Processing timed out after ${Math.round(
        staleness / 60000
      )} min (stuck on "${row.status}").`;
      await admin
        .from("estimations")
        .update({
          status: "error",
          error_message: timeoutMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.id);
      responseData = { ...row, status: "error", error_message: timeoutMsg };
    }
  }

  return NextResponse.json(responseData, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
