import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/admin/prompt-lab/ground-truth?dossierId=X — fetch GT for a dossier */
export async function GET(req: NextRequest) {
  const dossierId = req.nextUrl.searchParams.get("dossierId");
  if (!dossierId) {
    return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("benchmark_ground_truth")
    .select(
      "expert_total_price, expert_cat1_sqm, expert_cat2_sqm, expert_cat3_sqm, expert_finishing_level, extraction_confidence"
    )
    .eq("dossier_id", dossierId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(null);
  }

  return NextResponse.json(data);
}
