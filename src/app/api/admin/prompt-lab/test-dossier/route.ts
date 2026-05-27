/**
 * POST /api/admin/prompt-lab/test-dossier
 *
 * Runs the pipeline on a single dossier and returns the estimation ID.
 * Creates an estimation row, fires estimate-process (fire-and-forget),
 * and returns the ID for the client to poll.
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
    .select("id, tenant_id, plan_storage_path, plan_file_name")
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
    status: "uploaded",
    reference_dossier_id: dossier.id,
  });

  if (insertErr) {
    return NextResponse.json(
      { error: `Failed to create estimation: ${insertErr.message}` },
      { status: 500 }
    );
  }

  // Fire estimate-process (fire and forget)
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

  fetch(`${baseUrl}/api/estimate-process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ estimationId }),
  }).catch(() => {}); // intentional fire-and-forget

  return NextResponse.json({
    estimationId,
    dossierId,
    message: "Pipeline started. Poll estimation status to track progress.",
  });
}
