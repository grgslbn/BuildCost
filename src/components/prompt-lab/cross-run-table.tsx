import Link from "next/link";
import { cn } from "@/lib/utils";

type CrossRunResult = {
  run_id: string;
  run_name: string;
  run_date: string;
  extracted_cat1_sqm: number | null;
  extracted_cat2_sqm: number | null;
  extracted_cat3_sqm: number | null;
  cat1_error_pct: number | null;
  cat2_error_pct: number | null;
  cat3_error_pct: number | null;
  predicted_total_cost: number | null;
  cost_error_pct: number | null;
  predicted_f: number | null;
  expert_f: number | null;
  f_error: number | null;
  error_message: string | null;
};

function errorColor(pct: number | null): string {
  if (pct == null) return "";
  const abs = Math.abs(pct);
  if (abs <= 5) return "text-green-600";
  if (abs <= 10) return "text-amber-600";
  if (abs <= 15) return "text-orange-600";
  return "text-destructive font-medium";
}

function fmt(n: number | null | undefined, suffix = "%"): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}${suffix}`;
}

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

export function CrossRunTable({ results }: { results: CrossRunResult[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">Dit dossier is nog niet in een benchmark run verwerkt.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Run</th>
            <th className="px-4 py-3 text-right font-medium">Datum</th>
            <th className="px-4 py-3 text-right font-medium">Kosten</th>
            <th className="px-4 py-3 text-right font-medium">Cost Δ</th>
            <th className="px-4 py-3 text-right font-medium">Cat1 Δ</th>
            <th className="px-4 py-3 text-right font-medium">Cat2 Δ</th>
            <th className="px-4 py-3 text-right font-medium">Cat3 Δ</th>
            <th className="px-4 py-3 text-right font-medium">F Δ</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.run_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <Link href={`/admin/prompt-lab/${r.run_id}`} className="font-medium text-primary hover:underline">
                  {r.run_name}
                </Link>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {new Date(r.run_date).toLocaleDateString("nl-BE", { dateStyle: "short" })}
              </td>
              <td className="px-4 py-3 text-right">{fmtEur(r.predicted_total_cost)}</td>
              <td className={cn("px-4 py-3 text-right", errorColor(r.cost_error_pct))}>
                {r.error_message ? (
                  <span className="text-xs text-destructive" title={r.error_message}>Error</span>
                ) : (
                  fmt(r.cost_error_pct)
                )}
              </td>
              <td className={cn("px-4 py-3 text-right", errorColor(r.cat1_error_pct))}>{fmt(r.cat1_error_pct)}</td>
              <td className={cn("px-4 py-3 text-right", errorColor(r.cat2_error_pct))}>{fmt(r.cat2_error_pct)}</td>
              <td className={cn("px-4 py-3 text-right", errorColor(r.cat3_error_pct))}>{fmt(r.cat3_error_pct)}</td>
              <td className="px-4 py-3 text-right">{r.f_error != null ? r.f_error.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
