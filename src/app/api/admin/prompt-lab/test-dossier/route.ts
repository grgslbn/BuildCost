/**
 * POST /api/admin/prompt-lab/test-dossier
 *
 * Creates an estimation row for a dossier and returns the estimation ID.
 * The client is responsible for firing /api/estimate-process and polling status.
 * (Server-side fire-and-forget doesn't work reliably on Vercel.)
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { dossierId } = (await req.json()) as { dossierId: string };

  if (!dossierId) {
    return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Fetch dossier
  const { data: dossier } = await admin
    .from("reference_dossiers")
    .select("id, tenant_id, plan_storage_path, plan_file_name, postcode")
    .eq("id", dossierId)
    .single();

  if (!dossier?.plan_storage_path) {
    return NextResponse.json(
      { error: "Dossier not found or no plan uploaded" },
      { status: 404 }
    );
  }

  // Create estimation row
  const estimationId = randomUUID();
  const { error: insertErr } = await admin.from("estimations").insert({
    id: estimationId,
    tenant_id: dossier.tenant_id,
    plan_storage_path: dossier.plan_storage_path,
    plan_file_name: dossier.plan_file_name,
    postcode: dossier.postcode,
    status: "uploading",
  });

  if (insertErr) {
    return NextResponse.json(
      { error: `Failed to create estimation: ${insertErr.message}` },
      { status: 500 }
    );
  }

  // NOTE: The client fires /api/estimate-process directly after receiving the estimationId.
  // Server-side fire-and-forget doesn't work reliably on Vercel (function context dies after response).

  return NextResponse.json({
    estimationId,
    dossierId,
    message: "Estimation created. Client should fire estimate-process.",
  });
}
