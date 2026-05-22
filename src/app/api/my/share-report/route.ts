import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";

const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/my/share-report — email an estimation report link to a colleague
export async function POST(req: NextRequest) {
  const session = await getSessionWithRole();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { estimationId, toEmail } = await req.json();
  if (!estimationId || !toEmail) {
    return NextResponse.json({ error: "estimationId and toEmail are required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Verify the estimation belongs to the caller's tenant
  const { data: estimation } = await admin
    .from("estimations")
    .select("id, estimated_total_cost, building_type, postcode, plan_file_name")
    .eq("id", estimationId)
    .eq("tenant_id", session.profile.tenant_id)
    .maybeSingle();

  if (!estimation) {
    return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const reportUrl = `${appUrl}/report/${estimationId}`;

  const costFormatted = estimation.estimated_total_cost
    ? new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
        estimation.estimated_total_cost
      )
    : "—";

  const { error } = await resend.emails.send({
    from: "BuildCost <noreply@buildcost.be>",
    to: toEmail,
    subject: `Reconstruction cost estimate — ${estimation.plan_file_name ?? "Building plan"}`,
    html: `
      <p>Hello,</p>
      <p>${session.profile.full_name ?? session.profile.email} has shared a reconstruction cost estimation with you.</p>
      <p>
        <strong>Building:</strong> ${estimation.building_type ?? "Building"} (${estimation.postcode ?? "—"})<br/>
        <strong>Estimated cost:</strong> ${costFormatted}
      </p>
      <p>
        <a href="${reportUrl}" style="
          display:inline-block;
          padding:10px 20px;
          background:#C85A2A;
          color:#fff;
          text-decoration:none;
          border-radius:6px;
          font-weight:600;
        ">View full report</a>
      </p>
      <p style="color:#888;font-size:12px;">This link gives read-only access to the estimation report.</p>
    `,
  });

  if (error) {
    console.error("[share-report] Resend error:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
