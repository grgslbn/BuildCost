"use client";

import { cn } from "@/lib/utils";

export type ComparisonRow = {
  label: string;
  llm: number | null;
  expert: number | null;
  unit: string; // "m²", "€", ""
  errorPct: number | null; // precomputed or computed
};

function errorColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  const abs = Math.abs(pct);
  if (abs <= 5) return "text-green-600";
  if (abs <= 10) return "text-amber-600";
  if (abs <= 15) return "text-orange-600";
  return "text-red-600 font-medium";
}

function accuracyFromError(pct: number | null): number {
  if (pct == null) return 0;
  return Math.max(0, Math.min(100, 100 - Math.abs(pct)));
}

function barColor(accuracy: number): string {
  if (accuracy >= 90) return "bg-green-500";
  if (accuracy >= 80) return "bg-lime-500";
  if (accuracy >= 70) return "bg-amber-500";
  if (accuracy >= 60) return "bg-orange-500";
  return "bg-red-500";
}

function fmt(n: number | null, unit: string): string {
  if (n == null) return "—";
  if (unit === "€") return `€${Math.round(n).toLocaleString("nl-BE")}`;
  if (unit === "m²") return `${n.toFixed(1)} m²`;
  if (unit === "F") return n.toFixed(2);
  return n.toFixed(1);
}

function fmtDelta(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-2.5 text-left font-medium w-[120px]">Metric</th>
            <th className="px-4 py-2.5 text-right font-medium">LLM</th>
            <th className="px-4 py-2.5 text-right font-medium">Expert</th>
            <th className="px-4 py-2.5 text-right font-medium w-[80px]">Delta</th>
            <th className="px-4 py-2.5 font-medium w-[140px]">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const accuracy = accuracyFromError(row.errorPct);
            return (
              <tr key={row.label} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium">{row.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {fmt(row.llm, row.unit)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {fmt(row.expert, row.unit)}
                </td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums", errorColor(row.errorPct))}>
                  {fmtDelta(row.errorPct)}
                </td>
                <td className="px-4 py-2.5">
                  {row.errorPct != null ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", barColor(accuracy))}
                          style={{ width: `${accuracy}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground w-[32px] text-right">
                        {Math.round(accuracy)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compute an overall accuracy score (0-100) from individual error percentages */
export function computeOverallAccuracy(rows: ComparisonRow[]): number {
  const validErrors = rows
    .filter((r) => r.errorPct != null)
    .map((r) => Math.abs(r.errorPct!));
  if (validErrors.length === 0) return 0;
  const avgError = validErrors.reduce((a, b) => a + b, 0) / validErrors.length;
  return Math.max(0, Math.min(100, 100 - avgError));
}
