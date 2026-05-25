"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, Send, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

export type LeadRow = {
  id: string;
  email: string;
  company: string | null;
  role: string | null;
  intent: string | null;
  volume: string | null;
  region: string | null;
  created_at: string;
  email_sent: boolean;
  email_sent_at: string | null;
  email_error: string | null;
  estimation: {
    id: string;
    plan_file_name: string | null;
    postcode: string | null;
    building_type: string | null;
    total_livable_sqm: number | null;
    estimated_total_cost: number | null;
  } | null;
};

function formatEur(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(v);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-BE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(leads: LeadRow[]) {
  const header = ["email", "company", "role", "intent", "volume", "region", "building_type", "total_cost", "livable_sqm", "postcode", "email_sent", "date"];
  const lines = [header.join(",")];
  for (const l of leads) {
    lines.push([
      csvCell(l.email),
      csvCell(l.company),
      csvCell(l.role),
      csvCell(l.intent),
      csvCell(l.volume),
      csvCell(l.region),
      csvCell(l.estimation?.building_type),
      csvCell(l.estimation?.estimated_total_cost),
      csvCell(l.estimation?.total_livable_sqm),
      csvCell(l.estimation?.postcode),
      csvCell(l.email_sent ? "yes" : "no"),
      csvCell(l.created_at),
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `buildcost-leads-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function EmailStatus({ lead }: { lead: LeadRow }) {
  if (lead.email_sent) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Sent
      </span>
    );
  }
  if (!lead.estimation) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (lead.email_error) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600" title={lead.email_error}>
        <AlertCircle className="h-3.5 w-3.5" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
      <Clock className="h-3.5 w-3.5" />
      Pending
    </span>
  );
}

export function LeadsTable({ leads, pendingEmails }: { leads: LeadRow[]; pendingEmails: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [sendingLeadId, setSendingLeadId] = useState<string | null>(null);

  async function sendPending() {
    setSending(true);
    try {
      const res = await fetch("/api/send-pending-reports", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: "Bulk send failed",
          description: data.error ?? "request failed",
          variant: "destructive",
          duration: 6000,
        });
      } else {
        toast({
          title: `Sent ${data.sent} of ${data.processed} pending`,
          description: `errors ${data.errors} · skipped ${data.skipped}`,
          duration: 5000,
        });
        router.refresh();
      }
    } catch (err) {
      toast({
        title: "Bulk send failed",
        description: err instanceof Error ? err.message : "unknown",
        variant: "destructive",
        duration: 6000,
      });
    } finally {
      setSending(false);
    }
  }

  async function sendOne(leadId: string, email: string) {
    setSendingLeadId(leadId);
    try {
      const res = await fetch("/api/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "error") {
        toast({
          title: `Failed to send to ${email}`,
          description: data.message ?? data.error ?? "request failed",
          variant: "destructive",
          duration: 6000,
        });
      } else if (data.status === "sent") {
        toast({ title: `✓ Sent to ${email}`, duration: 4000 });
        router.refresh();
      } else {
        toast({
          title: `Skipped: ${email}`,
          description: data.reason ?? "see lead detail",
          duration: 5000,
        });
        router.refresh();
      }
    } catch (err) {
      toast({
        title: `Failed to send to ${email}`,
        description: err instanceof Error ? err.message : "unknown",
        variant: "destructive",
        duration: 6000,
      });
    } finally {
      setSendingLeadId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {pendingEmails > 0 ? (
            <>
              <Clock className="h-4 w-4 text-amber-600" />
              <span>{pendingEmails} report{pendingEmails === 1 ? "" : "s"} pending email</span>
            </>
          ) : (
            <span>All caught up</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={sendPending}
            disabled={sending || pendingEmails === 0}
          >
            <Send className="mr-2 h-4 w-4" />
            {sending ? "Sending…" : "Send pending reports"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv(leads)}
            disabled={leads.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
          <p className="text-sm text-muted-foreground">No leads yet.</p>
          <p className="text-xs text-muted-foreground">
            Leads will appear here when visitors submit the landing-page email form.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead>Volume</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Estimation</TableHead>
              <TableHead>Plan file</TableHead>
              <TableHead>Postcode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="pr-6 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => {
              const e = l.estimation;
              return (
                <TableRow key={l.id} className="hover:bg-muted/40">
                  <TableCell className="pl-6 font-medium text-sm">{l.email}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.company ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {l.intent ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        l.intent === "beta_signup" ? "bg-violet-100 text-violet-700" :
                        l.intent === "expert_review" ? "bg-amber-100 text-amber-700" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {l.intent.replace(/_/g, " ")}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.volume ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.region ?? "—"}</TableCell>
                  <TableCell>
                    {e ? (
                      <Link
                        href={`/estimations/${e.id}`}
                        className="block text-sm hover:underline"
                      >
                        <div className="font-medium capitalize">
                          {(e.building_type ?? "—").replace(/_/g, " ")}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {formatEur(e.estimated_total_cost)}
                          {e.total_livable_sqm != null && (
                            <> · {e.total_livable_sqm.toFixed(0)} m²</>
                          )}
                        </div>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground text-sm">
                    {e?.plan_file_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {e?.postcode ?? "—"}
                  </TableCell>
                  <TableCell>
                    <EmailStatus lead={l} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {formatDate(l.created_at)}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {!l.email_sent && l.estimation ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendOne(l.id, l.email)}
                        disabled={sendingLeadId === l.id}
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        {sendingLeadId === l.id ? "Sending…" : "Send"}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
