import { ServerClient } from "postmark";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const FROM = process.env.POSTMARK_FROM ?? "PlanBase <noreply@planbased.xyz>";
const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM ?? "outbound";
const REPORT_BASE = process.env.NEXT_PUBLIC_REPORT_BASE_URL ?? "https://build-cost-eight.vercel.app";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(Number(v));
}

function fmtSqm(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(1)} m²`;
}

type SubAreas = {
  cat1_sqm?: number; cat1_price_per_sqm?: number; cat1_cost?: number;
  cat2_sqm?: number; cat2_price_per_sqm?: number; cat2_cost?: number;
  cat3_sqm?: number; cat3_price_per_sqm?: number; cat3_cost?: number;
  regional_factor?: number; abex_factor?: number;
};

type EstimationRow = {
  id: string;
  building_type: string | null;
  total_livable_sqm: number | null;
  total_gross_sqm: number | null;
  finishing_level: string | null;
  estimated_total_cost: number | null;
  sub_areas: SubAreas | null;
  postcode: string | null;
};

// ── Email body ───────────────────────────────────────────────────────────────

function buildEmail(est: EstimationRow): { subject: string; text: string; html: string } {
  const reportUrl = `${REPORT_BASE}/report/${est.id}`;
  const total     = fmtEur(est.estimated_total_cost);
  const building  = (est.building_type ?? "Building").replace(/_/g, " ");
  const finishing = est.finishing_level ?? "Standard";
  const area      = fmtSqm(est.total_gross_sqm ?? est.total_livable_sqm);
  const sub       = est.sub_areas ?? {};

  const subject = `Your BuildCost rebuild estimate — ${total}`;

  const text = [
    "Hi,",
    "",
    "Here's your building reconstruction cost estimate:",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `ESTIMATED REBUILD COST: ${total}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Building type: ${building}`,
    `Finishing level: ${finishing}`,
    `Total area: ${area}`,
    "",
    "Cost breakdown:",
    `• Livable area:     ${fmtSqm(sub.cat1_sqm)} × ${fmtEur(sub.cat1_price_per_sqm)}/m² = ${fmtEur(sub.cat1_cost)}`,
    `• Garage & storage: ${fmtSqm(sub.cat2_sqm)} × ${fmtEur(sub.cat2_price_per_sqm)}/m² = ${fmtEur(sub.cat2_cost)}`,
    `• Terrace & balcony:${fmtSqm(sub.cat3_sqm)} × ${fmtEur(sub.cat3_price_per_sqm)}/m² = ${fmtEur(sub.cat3_cost)}`,
    "",
    sub.regional_factor != null ? `Regional adjustment: ×${sub.regional_factor.toFixed(3)}` : "",
    sub.abex_factor != null ? `ABEX 2026 index: ×${sub.abex_factor.toFixed(3)}` : "",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "View your full detailed report online:",
    reportUrl,
    "",
    "This includes:",
    "• Room-by-room breakdown",
    "• 35 quality parameter assessments",
    "• Price per m² explanation",
    "• Full calculation methodology",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "BuildCost — AI-powered reconstruction cost estimation",
    "Questions? Reply to this email.",
  ].filter(Boolean).join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#524840;">${label}</td><td style="padding:6px 0;text-align:right;color:#1A1714;font-weight:500;">${value}</td></tr>`;
  const breakdownRow = (label: string, sqm: number | undefined, price: number | undefined, cost: number | undefined) =>
    `<tr><td style="padding:8px 12px;color:#524840;border-top:1px solid #E8E0D8;">${label}</td><td style="padding:8px 12px;color:#9C9088;font-family:monospace;font-size:13px;border-top:1px solid #E8E0D8;">${fmtSqm(sqm)} × ${fmtEur(price)}</td><td style="padding:8px 12px;text-align:right;color:#1A1714;font-weight:500;border-top:1px solid #E8E0D8;">${fmtEur(cost)}</td></tr>`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#FBFAF5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1714;line-height:1.55;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBFAF5;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E8E0D8;">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #E8E0D8;">
        <div style="font-family:Georgia,serif;font-size:22px;color:#1A1714;">BuildCost</div>
        <div style="font-size:13px;color:#9C9088;margin-top:2px;">Your reconstruction cost estimate</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 16px;color:#524840;">Hi,</p>
        <p style="margin:0 0 24px;color:#524840;">Here's your building reconstruction cost estimate:</p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#FAE8DC,#FFFFFF);border:1px solid #E8C4A8;border-radius:8px;padding:0;margin-bottom:24px;">
          <tr><td style="padding:22px;text-align:center;">
            <div style="font-size:11px;color:#8B3C1A;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Estimated rebuild cost</div>
            <div style="font-family:Georgia,serif;font-size:34px;color:#8B3C1A;line-height:1;">${total}</div>
            <div style="margin-top:10px;font-size:13px;color:#524840;">${building} · ${finishing} finishing · ${area}</div>
          </td></tr>
        </table>

        <h3 style="font-family:Georgia,serif;font-size:15px;color:#1A1714;margin:0 0 12px;">Cost breakdown</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D8;border-radius:8px;overflow:hidden;font-size:14px;">
          <tr><td style="padding:8px 12px;background:#F2EDE8;color:#9C9088;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;" colspan="3">Areas</td></tr>
          ${breakdownRow("Livable area", sub.cat1_sqm, sub.cat1_price_per_sqm, sub.cat1_cost)}
          ${breakdownRow("Garage & storage", sub.cat2_sqm, sub.cat2_price_per_sqm, sub.cat2_cost)}
          ${breakdownRow("Terrace & balcony", sub.cat3_sqm, sub.cat3_price_per_sqm, sub.cat3_cost)}
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">
          ${sub.regional_factor != null ? row("Regional adjustment", `× ${sub.regional_factor.toFixed(3)}`) : ""}
          ${sub.abex_factor != null ? row("ABEX 2026 index", `× ${sub.abex_factor.toFixed(3)}`) : ""}
        </table>

        <div style="margin-top:28px;text-align:center;">
          <a href="${reportUrl}" style="display:inline-block;background:#C85A2A;color:#FFFFFF;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View full detailed report →</a>
        </div>

        <div style="margin-top:20px;padding:16px;background:#F2EDE8;border-radius:8px;font-size:13px;color:#524840;">
          <strong style="color:#1A1714;">Full report includes:</strong><br>
          · Room-by-room breakdown<br>
          · 35 quality parameter assessments<br>
          · Price per m² explanation<br>
          · Full calculation methodology
        </div>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #E8E0D8;font-size:12px;color:#9C9088;">
        BuildCost — AI-powered reconstruction cost estimation for Belgian insurance.<br>
        Questions? Just reply to this email.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}

// ── Types ────────────────────────────────────────────────────────────────────

export type SendReportResult =
  | { status: "sent"; messageId?: string }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string };

export type SharedByContext = { name: string; company: string };

// ── sendReportDirect — for customer sharing (no lead row needed) ─────────────

export async function sendReportDirect(
  estimationId: string,
  recipientEmail: string,
  sharedBy?: SharedByContext
): Promise<SendReportResult> {
  const apiKey = process.env.POSTMARK_SERVER_TOKEN;
  if (!apiKey) return { status: "error", message: "POSTMARK_SERVER_TOKEN not configured" };

  const admin = createSupabaseAdminClient();
  const { data: est, error } = await admin
    .from("estimations")
    .select("id, status, building_type, total_livable_sqm, total_gross_sqm, finishing_level, estimated_total_cost, sub_areas, postcode")
    .eq("id", estimationId)
    .single();

  if (error || !est) return { status: "error", message: "Estimation not found" };
  if (est.status !== "complete") return { status: "skipped", reason: `estimation status: ${est.status}` };

  const { subject: baseSubject, text: baseText, html: baseHtml } = buildEmail(est as EstimationRow);

  // Override subject and inject sharedBy context when sharing
  const subject = sharedBy
    ? `Building reconstruction estimate — shared by ${sharedBy.name}`
    : baseSubject;

  const sharedByBanner = sharedBy
    ? `<div style="background:#F2EDE8;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:14px;color:#524840;">
        <strong style="color:#1A1714;">${sharedBy.name}</strong> from <strong style="color:#1A1714;">${sharedBy.company}</strong> has shared this reconstruction estimate with you.
      </div>`
    : "";

  const html = sharedBy
    ? baseHtml.replace(
        '<p style="margin:0 0 16px;color:#524840;">Hi,</p>',
        `<p style="margin:0 0 16px;color:#524840;">Hi,</p>${sharedByBanner}`
      )
    : baseHtml;

  const text = sharedBy
    ? `${sharedBy.name} (${sharedBy.company}) has shared this reconstruction estimate with you.\n\n${baseText}`
    : baseText;

  try {
    const client = new ServerClient(apiKey);
    const result = await client.sendEmail({
      From: FROM,
      To: recipientEmail,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      MessageStream: MESSAGE_STREAM,
    });
    return { status: "sent", messageId: result.MessageID };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { status: "error", message: msg };
  }
}

// ── sendReportForLead (legacy — public funnel) ────────────────────────────────

export async function sendReportForLead(leadId: string): Promise<SendReportResult> {
  const SR_LOG = "[send-report]";
  const apiKey = process.env.POSTMARK_SERVER_TOKEN;
  console.log(SR_LOG, "called", {
    leadId,
    hasKey: !!apiKey,
    keyLen: apiKey?.length ?? 0,
    keyPrefix: apiKey?.slice(0, 4) ?? null,
    from: FROM,
  });

  if (!apiKey) {
    console.error(SR_LOG, "no POSTMARK_SERVER_TOKEN in process.env");
    return { status: "error", message: "POSTMARK_SERVER_TOKEN not configured" };
  }

  const admin = createSupabaseAdminClient();

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, email, email_sent, estimation_id")
    .eq("id", leadId)
    .single();
  console.log(SR_LOG, "lead lookup", {
    leadId,
    email: lead?.email ?? null,
    email_sent: lead?.email_sent ?? null,
    estimation_id: lead?.estimation_id ?? null,
    error: leadErr?.message ?? null,
  });
  if (leadErr || !lead) return { status: "error", message: "Lead not found" };
  if (lead.email_sent) {
    console.log(SR_LOG, "already sent — skipping");
    return { status: "skipped", reason: "already sent" };
  }
  if (!lead.estimation_id) {
    console.log(SR_LOG, "no estimation linked — skipping");
    return { status: "skipped", reason: "no estimation linked" };
  }

  const { data: est, error: estErr } = await admin
    .from("estimations")
    .select("id, status, building_type, total_livable_sqm, total_gross_sqm, finishing_level, estimated_total_cost, sub_areas, postcode")
    .eq("id", lead.estimation_id)
    .single();
  console.log(SR_LOG, "estimation lookup", {
    estimationId: lead.estimation_id,
    status: est?.status ?? null,
    hasSubAreas: !!est?.sub_areas,
    totalCost: est?.estimated_total_cost ?? null,
    error: estErr?.message ?? null,
  });
  if (estErr || !est) return { status: "error", message: "Estimation not found" };
  if (est.status !== "complete") {
    console.log(SR_LOG, "estimation not complete — skipping", { status: est.status });
    return { status: "skipped", reason: `estimation status: ${est.status}` };
  }

  const { subject, text, html } = buildEmail(est as EstimationRow);
  console.log(SR_LOG, "calling Resend API", {
    to: lead.email,
    from: FROM,
    subject,
    textLen: text.length,
    htmlLen: html.length,
  });

  try {
    const client = new ServerClient(apiKey);
    const result = await client.sendEmail({
      From: FROM,
      To: lead.email,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      MessageStream: MESSAGE_STREAM,
    });

    console.log(SR_LOG, "Postmark API response", {
      messageId: result.MessageID,
      to: result.To,
      submittedAt: result.SubmittedAt,
    });

    await admin.from("leads").update({
      email_sent: true,
      email_sent_at: new Date().toISOString(),
      email_error: null,
    }).eq("id", leadId);

    console.log(SR_LOG, "email sent successfully", { leadId, messageId: result.MessageID });
    return { status: "sent", messageId: result.MessageID };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(SR_LOG, "Postmark threw exception", { msg, err });
    await admin.from("leads").update({ email_error: msg }).eq("id", leadId);
    return { status: "error", message: msg };
  }
}

// ── sendBetaWelcomeEmail ──────────────────────────────────────────────────────

export async function sendBetaWelcomeEmail(
  recipientEmail: string,
  companyName: string | null
): Promise<SendReportResult> {
  const serverToken = process.env.POSTMARK_SERVER_TOKEN;
  if (!serverToken) return { status: "error", message: "POSTMARK_SERVER_TOKEN not configured" };

  const company = companyName ?? "your company";
  const subject = "Welcome to PlanBase — beta access confirmed";

  const text = [
    `Hi,`,
    ``,
    `Thanks for requesting beta access to PlanBase for ${company}.`,
    ``,
    `We're building AI-powered reconstruction cost estimation for Belgian insurers,`,
    `and your early feedback will shape the product.`,
    ``,
    `Here's what happens next:`,
    ``,
    `1. We'll set up your tenant within 24 hours`,
    `2. You'll receive a magic link to access your dashboard`,
    `3. Upload your first building plan and get an instant estimate`,
    ``,
    `During the beta, everything is free. Your dossiers help train our model,`,
    `and your feedback directly shapes v1.`,
    ``,
    `Questions? Just reply to this email.`,
    ``,
    `— The PlanBase team`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F6F5F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F5F1;">
  <tr><td align="center" style="padding:40px 20px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #E8E0D8;overflow:hidden;">
      <tr><td style="padding:28px 28px 0;">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1A1714;margin-bottom:4px;">PlanBase</div>
        <div style="font-size:12px;color:#9C9088;margin-bottom:24px;">AI-powered reconstruction cost estimation</div>
      </td></tr>
      <tr><td style="padding:0 28px 28px;">
        <p style="margin:0 0 16px;color:#524840;font-size:15px;line-height:1.6;">Hi,</p>
        <p style="margin:0 0 16px;color:#524840;font-size:15px;line-height:1.6;">
          Thanks for requesting beta access to PlanBase for <strong style="color:#1A1714;">${company}</strong>.
          We're building AI-powered reconstruction cost estimation for Belgian insurers,
          and your early feedback will shape the product.
        </p>
        <div style="background:#F2EDE8;border-radius:8px;padding:20px;margin:20px 0;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#1A1714;margin-bottom:12px;">What happens next</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:5px 0;font-size:14px;color:#524840;">1 · We'll set up your tenant within 24 hours</td></tr>
            <tr><td style="padding:5px 0;font-size:14px;color:#524840;">2 · You'll receive a magic link to your dashboard</td></tr>
            <tr><td style="padding:5px 0;font-size:14px;color:#524840;">3 · Upload your first plan → instant estimate</td></tr>
          </table>
        </div>
        <p style="margin:0 0 16px;color:#524840;font-size:15px;line-height:1.6;">
          During the beta, everything is free. Your dossiers help train our model,
          and your feedback directly shapes v1.
        </p>
        <p style="margin:0;color:#524840;font-size:15px;line-height:1.6;">
          Questions? Just reply to this email.
        </p>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #E8E0D8;font-size:12px;color:#9C9088;">
        PlanBase — AI-powered reconstruction cost estimation for Belgian insurance.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const client = new ServerClient(serverToken);
    const result = await client.sendEmail({
      From: FROM,
      To: recipientEmail,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      MessageStream: MESSAGE_STREAM,
    });
    return { status: "sent", messageId: result.MessageID };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { status: "error", message: msg };
  }
}

// ── sendAdminAlert ────────────────────────────────────────────────────────────

export async function sendAdminAlert(
  lead: { email: string; company: string | null; intent: string },
  extra?: { estimationId?: string; volume?: string | null; region?: string | null }
): Promise<void> {
  const serverToken = process.env.POSTMARK_SERVER_TOKEN;
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!serverToken || !adminEmail) return; // silently skip if not configured

  const isBeta = lead.intent === "beta_signup";
  const subject = isBeta
    ? `🟢 New beta signup: ${lead.company ?? lead.email}`
    : `📄 New upload: ${lead.email}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://planbased.xyz";

  const lines = [
    `Email: ${lead.email}`,
    lead.company ? `Company: ${lead.company}` : null,
    extra?.volume ? `Volume: ${extra.volume}` : null,
    extra?.region ? `Region: ${extra.region}` : null,
    extra?.estimationId
      ? `Estimation: ${appUrl}/estimations/${extra.estimationId}`
      : null,
    `Intent: ${lead.intent}`,
    `Time: ${new Date().toLocaleString("fr-BE", { timeZone: "Europe/Brussels" })}`,
  ].filter(Boolean).join("\n");

  const text = `New lead on PlanBase:\n\n${lines}\n\nView all leads: ${appUrl}/admin/leads`;

  try {
    const client = new ServerClient(serverToken);
    await client.sendEmail({
      From: FROM,
      To: adminEmail,
      Subject: subject,
      TextBody: text,
      MessageStream: MESSAGE_STREAM,
    });
  } catch (err) {
    // Non-blocking — log but never fail the user flow
    console.error("[admin-alert] failed:", err instanceof Error ? err.message : err);
  }
}
