"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, AlertCircle } from "lucide-react";

export type DossierRow = {
  id: string;
  address: string | null;
  postcode: string | null;
  building_type: string | null;
  known_price_per_sqm: number | null;
  expert_finishing_level: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  extracting_sqm: "default",
  sqm_done: "default",
  extracting_qqp: "default",
  analyzed: "outline",
  validated: "outline",
  error: "destructive",
};

function formatCurrency(v: number | null) {
  if (!v) return "—";
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function DossierTable({ dossiers }: { dossiers: DossierRow[] }) {
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const sorted = [...dossiers].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortAsc ? diff : -diff;
  });

  function toggleError(id: string) {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  if (dossiers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No reference dossiers yet. Upload one above.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Address</TableHead>
            <TableHead>Postcode</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Price / m²</TableHead>
            <TableHead>Finishing</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-8"
                onClick={() => setSortAsc((p) => !p)}
              >
                Date
                <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((d) => (
            <>
              <TableRow
                key={d.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => {
                  if (d.status === "error" && d.error_message) {
                    toggleError(d.id);
                  } else {
                    window.location.href = `/admin/dossiers/${d.id}`;
                  }
                }}
              >
                <TableCell className="max-w-[180px] truncate font-medium">
                  <Link
                    href={`/admin/dossiers/${d.id}`}
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {d.address ?? <span className="text-muted-foreground">—</span>}
                  </Link>
                </TableCell>
                <TableCell>{d.postcode ?? "—"}</TableCell>
                <TableCell className="capitalize">{d.building_type ?? "—"}</TableCell>
                <TableCell>{formatCurrency(d.known_price_per_sqm)}</TableCell>
                <TableCell className="capitalize">{d.expert_finishing_level ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>
                      {d.status.replace(/_/g, " ")}
                    </Badge>
                    {d.status === "error" && d.error_message && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleError(d.id); }}
                        className="text-destructive hover:text-destructive/80"
                        title="Show error"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(d.created_at)}</TableCell>
              </TableRow>

              {/* Expandable error row */}
              {d.status === "error" && d.error_message && expandedErrors.has(d.id) && (
                <TableRow key={`${d.id}-error`} className="bg-destructive/5 hover:bg-destructive/5">
                  <TableCell colSpan={7} className="py-2 pl-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium text-destructive">Processing error</p>
                        <p className="font-mono text-xs text-destructive/80">{d.error_message}</p>
                        <Link
                          href={`/admin/dossiers/${d.id}`}
                          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open dossier →
                        </Link>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
