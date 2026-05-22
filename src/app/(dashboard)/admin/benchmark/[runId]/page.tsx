// src/app/(dashboard)/admin/benchmark/[runId]/page.tsx
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import type { EvaluationRun, EvaluationResult } from "@/lib/benchmark/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(n: number | null | undefined, suffix = "%"): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}${suffix}`;
}

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

function errorColor(pct: number | null): string {
  if (pct == null) return "";
  const abs = Math.abs(pct);
  if (abs <= 5) return "text-green-600";
  if (abs <= 10) return "text-amber-600";
  if (abs <= 15) return "text-orange-600";
  return "text-destructive font-medium";
}

export default async function BenchmarkRunDetailPage({
  params,
}: {
  params: { runId: string };
}) {
  const admin = createSupabaseAdminClient();

  const { data: run } = await admin
    .from("evaluation_runs")
    .select("*")
    .eq("id", params.runId)
    .single();

  if (!run) {
    return <div className="p-8 text-center text-muted-foreground">Run not found.</div>;
  }

  const { data: results } = await admin
    .from("evaluation_results")
    .select("*, reference_dossiers!inner(plan_file_name)")
    .eq("run_id", params.runId)
    .order("created_at", { ascending: true });

  // Sort by absolute cost error descending (worst first), errors at top
  const sorted = [...(results ?? [])].sort((a, b) => {
    if (a.error_message && !b.error_message) return -1;
    if (!a.error_message && b.error_message) return 1;
    const absA = a.cost_error_pct != null ? Math.abs(a.cost_error_pct) : -1;
    const absB = b.cost_error_pct != null ? Math.abs(b.cost_error_pct) : -1;
    return absB - absA;
  });

  const metrics = run.metrics as EvaluationRun["metrics"];

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <div className="flex items-center gap-3">
        <Link href="/admin/benchmark" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{run.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.dossier_count} dossiers · {run.subset_mode} · {new Date(run.started_at).toLocaleString("nl-BE")}
          </p>
        </div>
      </div>

      {/* Aggregate metrics cards */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Cost MAE</p>
              <p className="text-2xl font-semibold">{fmt(metrics.cost_mae_pct)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Cost Median</p>
              <p className="text-2xl font-semibold">{fmt(metrics.cost_median_pct)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Within 15%</p>
              <p className="text-2xl font-semibold">{fmt(metrics.cost_within_15_pct ? metrics.cost_within_15_pct * 100 : null)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">F MAE</p>
              <p className="text-2xl font-semibold">{metrics.f_mae?.toFixed(2) ?? "—"}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Per-dossier results table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Dossier</th>
                <th className="px-4 py-3 text-right font-medium">Predicted cost</th>
                <th className="px-4 py-3 text-right font-medium">Cost error</th>
                <th className="px-4 py-3 text-right font-medium">Cat1 Δ</th>
                <th className="px-4 py-3 text-right font-medium">Cat2 Δ</th>
                <th className="px-4 py-3 text-right font-medium">Cat3 Δ</th>
                <th className="px-4 py-3 text-right font-medium">F Δ</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r: Record<string, unknown>) => {
                const result = r as EvaluationResult & { reference_dossiers: { plan_file_name: string | null } };
                const fileName = result.reference_dossiers?.plan_file_name || result.dossier_id.slice(0, 8);
                return (
                  <tr key={result.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{fileName}</td>
                    <td className="px-4 py-3 text-right">{fmtEur(result.predicted_total_cost)}</td>
                    <td className={cn("px-4 py-3 text-right", errorColor(result.cost_error_pct))}>
                      {result.cost_error_pct != null ? `${result.cost_error_pct > 0 ? "+" : ""}${result.cost_error_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className={cn("px-4 py-3 text-right", errorColor(result.cat1_error_pct))}>{fmt(result.cat1_error_pct)}</td>
                    <td className={cn("px-4 py-3 text-right", errorColor(result.cat2_error_pct))}>{fmt(result.cat2_error_pct)}</td>
                    <td className={cn("px-4 py-3 text-right", errorColor(result.cat3_error_pct))}>{fmt(result.cat3_error_pct)}</td>
                    <td className="px-4 py-3 text-right">{result.f_error != null ? result.f_error.toFixed(2) : "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {result.error_message ? (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive" title={result.error_message}>
                          <XCircle className="h-3 w-3" /> Error
                        </span>
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-green-500 mx-auto" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
