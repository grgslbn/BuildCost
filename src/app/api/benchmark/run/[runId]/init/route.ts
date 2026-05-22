// POST: create an estimation row for a benchmark dossier
// Returns estimationId so the CLIENT can call estimate-process (needs auth cookies)
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const { dossierId } = (await req.json()) as { dossierId: string };
    if (!dossierId) {
      return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Check ground truth exists
    const { data: gt } = await admin
      .from("benchmark_ground_truth")
      .select("dossier_id, reference_dossiers!inner(tenant_id, plan_storage_path, plan_file_name, postcode)")
      .eq("dossier_id", dossierId)
      .single();

    if (!gt) {
      return NextResponse.json({ error: "No ground truth for this dossier" }, { status: 404 });
    }

    const dossier = gt.reference_dossiers as unknown as Record<string, unknown>;

    // Create estimation row
    const { data: est, error: estErr } = await admin
      .from("estimations")
      .insert({
        tenant_id: dossier.tenant_id,
        plan_storage_path: dossier.plan_storage_path,
        plan_file_name: dossier.plan_file_name,
        postcode: dossier.postcode,
        status: "uploading",
      })
      .select("id")
      .single();

    if (estErr || !est) {
      return NextResponse.json({ error: `Create estimation: ${estErr?.message}` }, { status: 500 });
    }

    return NextResponse.json({ estimationId: est.id });
  } catch (err) {
    console.error("[benchmark/run/init]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
