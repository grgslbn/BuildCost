import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/public-rate-limit";
import { sendReportForLead } from "@/lib/email/send-report";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOG = "[public/leads]";

export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();
  const body = (await req.json()) as {
    email?: string;
    company?: string;
    role?: string;
    estimationId?: string;
    intent?: "report" | "expert_review";
  };

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  console.log(LOG, "incoming", {
    email,
    estimationId: body.estimationId ?? null,
    intent: body.intent ?? "report",
    hasResendKey: !!process.env.RESEND_API_KEY,
    resendKeyLen: process.env.RESEND_API_KEY?.length ?? 0,
    resendKeyPrefix: process.env.RESEND_API_KEY?.slice(0, 4) ?? null,
  });

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      email,
      company: body.company?.trim() || null,
      role: body.role?.trim() || null,
      estimation_id: body.estimationId ?? null,
      ip_address: getClientIp(req),
      user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    })
    .select("id")
    .single();

  if (error || !lead) {
    console.error(LOG, "insert failed", error?.message);
    return NextResponse.json(
      { error: error?.message ?? "Failed to save lead" },
      { status: 500 }
    );
  }

  console.log(LOG, "lead saved", lead.id);

  let emailStatus: "sent" | "pending" | "no_estimation" | "error" = "pending";
  let emailDebug: string | null = null;

  if (!body.estimationId) {
    emailStatus = "no_estimation";
    console.log(LOG, "no estimationId → skipping email send");
  } else if (body.intent === "expert_review") {
    console.log(LOG, "intent=expert_review → no automatic email");
  } else {
    const { data: est, error: estErr } = await admin
      .from("estimations")
      .select("status")
      .eq("id", body.estimationId)
      .single();

    console.log(LOG, "estimation lookup", {
      estimationId: body.estimationId,
      status: est?.status ?? null,
      error: estErr?.message ?? null,
    });

    if (estErr || !est) {
      emailDebug = `estimation lookup failed: ${estErr?.message ?? "not found"}`;
    } else if (est.status !== "complete") {
      // Estimation still processing — will be picked up by /api/send-pending-reports
      console.log(LOG, "estimation not complete yet — deferring email", { status: est.status });
      emailDebug = `deferred (estimation status: ${est.status})`;
    } else if (!process.env.RESEND_API_KEY) {
      // Estimation IS complete but the API key is missing. Persist this on
      // the lead row so the admin UI surfaces it instead of silently failing.
      console.error(LOG, "RESEND_API_KEY is NOT set — cannot send email");
      await admin
        .from("leads")
        .update({ email_error: "RESEND_API_KEY not configured at request time" })
        .eq("id", lead.id);
      emailStatus = "error";
      emailDebug = "RESEND_API_KEY not configured";
    } else {
      console.log(LOG, "attempting synchronous send for lead", lead.id);
      const result = await sendReportForLead(lead.id);
      console.log(LOG, "sendReportForLead result", result);
      if (result.status === "sent") {
        emailStatus = "sent";
      } else if (result.status === "error") {
        emailStatus = "error";
        emailDebug = result.message;
      } else {
        emailDebug = `skipped: ${result.reason}`;
      }
    }
  }

  console.log(LOG, "done", { leadId: lead.id, emailStatus, emailDebug });

  return NextResponse.json({ status: "ok", leadId: lead.id, emailStatus, emailDebug });
}
