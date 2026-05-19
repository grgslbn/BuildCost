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
import { ArrowUpDown } from "lucide-react";

export type DossierRow = {
  id: string;
  address: string | null;
  postcode: string | null;
  building_type: string | null;
  known_price_per_sqm: number | null;
  expert_finishing_level: string | null;
  status: string;
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

  const sorted = [...dossiers].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortAsc ? diff : -diff;
  });

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
            <TableRow
              key={d.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => window.location.href = `/admin/dossiers/${d.id}`}
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
                <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>
                  {d.status.replace(/_/g, " ")}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDate(d.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
