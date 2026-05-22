import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { sendReportDirect } from "@/lib/email/send-report";

// POST /api/my/share-report — email an estimation report link to a colleague
export async function POST(req: NextRequest) {
  const session = await getSessionWithRole();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { estimationId, toEmail } = (await req.json()) as {
    estimationId?: string;
    toEmail?: string;
  };
  if (!estimationId || !toEmail) {
    return NextResponse.json({ error: "estimationId and toEmail are required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Verify the estimation belongs to the caller's tenant
  const { data: estimation } = await admin
    .from("estimations")
    .select("id, status")
    .eq("id", estimationId)
    .eq("tenant_id", session.profile.tenant_id)
    .maybeSingle();

  if (!estimation) {
    return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
  }

  // Resolve tenant name for the "Shared by" context
  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", session.profile.tenant_id)
    .maybeSingle();

  const sharedBy = {
    name: session.profile.full_name ?? session.profile.email ?? "A colleague",
    company: (tenant?.name as string | null) ?? "Plan Based",
  };

  const result = await sendReportDirect(estimationId, toEmail, sharedBy);

  if (result.status === "error") {
    console.error("[share-report]", result.message);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: result.status });
}
