import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendReportForLead } from "@/lib/email/send-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Finds leads where email_sent = false AND their estimation is complete,
// then sends each report sequentially. Safe to call multiple times.
export async function POST() {
  const admin = createSupabaseAdminClient();

  const { data: pending, error } = await admin
    .from("leads")
    .select("id, estimation_id, estimations!inner(status)")
    .eq("email_sent", false)
    .not("estimation_id", "is", null)
    .eq("estimations.status", "complete")
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (pending ?? []) as Array<{ id: string }>;
  const results: Array<{ leadId: string; status: string; message?: string }> = [];

  for (const lead of rows) {
    const r = await sendReportForLead(lead.id);
    results.push({
      leadId: lead.id,
      status: r.status,
      ...(r.status === "error" ? { message: r.message } : {}),
      ...(r.status === "skipped" ? { message: r.reason } : {}),
    });
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const errors = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return NextResponse.json({
    processed: results.length,
    sent,
    errors,
    skipped,
    results,
  });
}
