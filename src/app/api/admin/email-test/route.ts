import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import {
  sendBetaWelcomeEmail,
  sendAdminAlert,
  sendReportDirect,
} from "@/lib/email/send-report";
import { SKIP_AUTH } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

async function pickEstimation(admin: ReturnType<typeof createSupabaseAdminClient>, estimationId?: string) {
  if (estimationId) return estimationId;
  const { data } = await admin
    .from("estimations")
    .select("id")
    .eq("status", "complete")
    .not("estimated_total_cost", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  if (!SKIP_AUTH) {
    const session = await getSessionWithRole();
    if (!session?.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json()) as {
    type: string;
    to: string;
    estimationId?: string;
  };

  const { type, to, estimationId } = body;

  if (!to || !type) {
    return NextResponse.json({ error: "'type' and 'to' are required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  switch (type) {
    // ── Postmark emails ───────────────────────────────────────────────────────

    case "beta_welcome": {
      const result = await sendBetaWelcomeEmail(to, "ACME Insurance BV [TEST]");
      return NextResponse.json(result);
    }

    case "admin_alert": {
      await sendAdminAlert(
        { email: to, company: "ACME Insurance BV [TEST]", intent: "beta_signup" },
        { volume: "100–500/yr", region: "Antwerpen" }
      );
      return NextResponse.json({ status: "sent" });
    }

    case "report": {
      const estId = await pickEstimation(admin, estimationId);
      if (!estId) return NextResponse.json({ error: "No complete estimation found" }, { status: 404 });
      const result = await sendReportDirect(estId, to);
      return NextResponse.json({ ...result, estimationId: estId });
    }

    case "shared_report": {
      const estId = await pickEstimation(admin, estimationId);
      if (!estId) return NextResponse.json({ error: "No complete estimation found" }, { status: 404 });
      const result = await sendReportDirect(estId, to, {
        name: "Georges Slieben",
        company: "PlanBase [TEST]",
      });
      return NextResponse.json({ ...result, estimationId: estId });
    }

    // ── Supabase Auth emails (magic link + invite) ────────────────────────────
    // These go through Supabase Auth → configured SMTP (Postmark).
    // Magic link is triggered by the real /login page.
    // Invite is triggered by /admin/tenants.

    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }
}
