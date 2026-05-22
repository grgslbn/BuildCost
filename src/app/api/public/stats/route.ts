import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("reference_dossiers")
    .select("*", { count: "exact", head: true });

  return NextResponse.json(
    { buildingsAnalyzed: count ?? 0 },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
