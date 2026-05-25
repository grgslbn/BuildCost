"use client";

import { useState } from "react";
import { Send, CheckCircle2, AlertCircle, Loader2, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TestStatus = "idle" | "sending" | "ok" | "error";

type EmailDef = {
  id: string;
  system: "postmark" | "supabase";
  number: number;
  title: string;
  trigger: string;
  subject: string;
  description: string;
  link?: { label: string; href: string };
};

const EMAILS: EmailDef[] = [
  {
    id: "magic_link",
    system: "supabase",
    number: 1,
    title: "Magic link (login)",
    trigger: "User submits /login",
    subject: 'Supabase default -- "Sign in to PlanBase"',
    description: "Goes through Supabase Auth via your Postmark SMTP config. Test by visiting /login and entering an email.",
    link: { label: "Open /login", href: "/login" },
  },
  {
    id: "invite",
    system: "supabase",
    number: 2,
    title: "Tenant invite",
    trigger: "Admin sends invite in /admin/tenants",
    subject: "Supabase default -- invite + magic link",
    description: "Goes through Supabase Auth via your Postmark SMTP config. Test by inviting a user under any tenant.",
    link: { label: "Open /admin/tenants", href: "/admin/tenants" },
  },
  {
    id: "beta_welcome",
    system: "postmark",
    number: 3,
    title: "Beta welcome",
    trigger: "Landing page CTA form submitted",
    subject: '"Welcome to PlanBase -- beta access confirmed"',
    description: 'Sent immediately when someone signs up for beta access. Includes "What happens next" + link to planbased.xyz.',
  },
  {
    id: "admin_alert",
    system: "postmark",
    number: 4,
    title: "Admin alert",
    trigger: "Every lead submission (fire-and-forget)",
    subject: '"🟢 New beta signup: ACME Insurance BV [TEST]"',
    description: "Text-only alert sent to ADMIN_ALERT_EMAIL. Shows email, company, volume, region, intent, timestamp.",
  },
  {
    id: "report",
    system: "postmark",
    number: 5,
    title: "Reconstruction report",
    trigger: "Public visitor uploads plan + submits email",
    subject: '"Your PlanBase rebuild estimate -- €X"',
    description: "Full cost breakdown with CAT1/2/3 areas, regional factor, ABEX. Links to /report/[id] on planbased.xyz.",
  },
  {
    id: "shared_report",
    system: "postmark",
    number: 6,
    title: "Shared report",
    trigger: 'Customer clicks "Share by email" in portal',
    subject: '"Building reconstruction estimate -- shared by Georges Slieben"',
    description: 'Same as #5 but with a "Georges Slieben from PlanBase [TEST] shared this with you" banner at the top.',
  },
];

type Result = { status: TestStatus; message?: string; estimationId?: string };

export default function EmailTestPage() {
  const [to, setTo] = useState("");
  const [results, setResults] = useState<Record<string, Result>>({});

  async function fire(emailId: string) {
    if (!to) return;
    setResults((r) => ({ ...r, [emailId]: { status: "sending" } }));
    try {
      const res = await fetch("/api/admin/email-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: emailId, to }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "error") {
        setResults((r) => ({
          ...r,
          [emailId]: { status: "error", message: data.error ?? data.message ?? "failed" },
        }));
      } else {
        setResults((r) => ({
          ...r,
          [emailId]: { status: "ok", message: data.estimationId ? `estimation: ${data.estimationId.slice(0, 8)}…` : undefined },
        }));
      }
    } catch (err) {
      setResults((r) => ({
        ...r,
        [emailId]: { status: "error", message: err instanceof Error ? err.message : "network error" },
      }));
    }
  }

  const postmarkEmails = EMAILS.filter((e) => e.system === "postmark");
  const supabaseEmails = EMAILS.filter((e) => e.system === "supabase");

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-3xl space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email test panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fire each email type to any address. Postmark emails send immediately; Supabase emails go through the Auth SMTP config.
          </p>
        </div>

        {/* Recipient input */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="to">Send all test emails to</Label>
                <Input
                  id="to"
                  type="email"
                  placeholder="you@example.com"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
            {!to && (
              <p className="mt-2 text-xs text-amber-600">Enter an email address above to enable the test buttons.</p>
            )}
          </CardContent>
        </Card>

        {/* Postmark emails */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              System B — Postmark
            </h2>
            <Badge variant="outline" className="text-xs">team@planbased.xyz</Badge>
          </div>

          {postmarkEmails.map((email) => {
            const result = results[email.id];
            return (
              <Card key={email.id}>
                <CardHeader className="pb-2 pt-4 px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">#{email.number}</span>
                        <CardTitle className="text-base">{email.title}</CardTitle>
                      </div>
                      <CardDescription className="text-xs">Trigger: {email.trigger}</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      disabled={!to || result?.status === "sending"}
                      onClick={() => fire(email.id)}
                      className="shrink-0"
                    >
                      {result?.status === "sending" ? (
                        <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Sending…</>
                      ) : (
                        <><Send className="mr-1.5 h-3.5 w-3.5" />Send test</>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Subject:</span> {email.subject}
                  </p>
                  <p className="text-xs text-muted-foreground">{email.description}</p>
                  {result?.status === "ok" && (
                    <div className="flex items-center gap-1.5 text-xs text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Sent to {to}{result.message ? ` · ${result.message}` : ""}
                    </div>
                  )}
                  {result?.status === "error" && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {result.message}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Supabase Auth emails */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              System A — Supabase Auth SMTP
            </h2>
            <Badge variant="outline" className="text-xs">team@planbased.xyz via Postmark SMTP</Badge>
          </div>

          {supabaseEmails.map((email) => (
            <Card key={email.id} className="border-dashed">
              <CardHeader className="pb-2 pt-4 px-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">#{email.number}</span>
                      <CardTitle className="text-base">{email.title}</CardTitle>
                    </div>
                    <CardDescription className="text-xs">Trigger: {email.trigger}</CardDescription>
                  </div>
                  {email.link && (
                    <Button size="sm" variant="outline" className="shrink-0" asChild>
                      <a href={email.link.href}>
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        {email.link.label}
                      </a>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Subject:</span> {email.subject}
                </p>
                <div className="flex items-start gap-1.5 text-xs text-blue-600">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{email.description}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

      </div>
    </div>
  );
}
