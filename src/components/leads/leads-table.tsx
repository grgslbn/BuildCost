"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export type LeadRow = {
  id: string;
  email: string;
  company: string | null;
  role: string | null;
  created_at: string;
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
  const header = ["email", "company", "role", "building_type", "total_cost", "livable_sqm", "postcode", "date"];
  const lines = [header.join(",")];
  for (const l of leads) {
    lines.push([
      csvCell(l.email),
      csvCell(l.company),
      csvCell(l.role),
      csvCell(l.estimation?.building_type),
      csvCell(l.estimation?.estimated_total_cost),
      csvCell(l.estimation?.total_livable_sqm),
      csvCell(l.estimation?.postcode),
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

export function LeadsTable({ leads }: { leads: LeadRow[] }) {
  return (
    <div>
      <div className="flex items-center justify-end border-b px-6 py-3">
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
              <TableHead>Role</TableHead>
              <TableHead>Estimation</TableHead>
              <TableHead>Plan file</TableHead>
              <TableHead>Postcode</TableHead>
              <TableHead className="pr-6">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => {
              const e = l.estimation;
              return (
                <TableRow key={l.id} className="hover:bg-muted/40">
                  <TableCell className="pl-6 font-medium text-sm">{l.email}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.company ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.role ?? "—"}</TableCell>
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
                  <TableCell className="pr-6 text-muted-foreground text-sm tabular-nums">
                    {formatDate(l.created_at)}
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
