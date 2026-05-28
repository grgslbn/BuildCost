// src/app/(dashboard)/admin/prompt-lab/page.tsx
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EvaluationRun, GroundTruth } from "@/lib/prompt-lab/types";
import { ExtractGroundTruthButton } from "@/components/prompt-lab/extract-gt-button";
import { StartRunButton } from "@/components/prompt-lab/start-run-button";
import { DossierUploadTable } from "@/components/prompt-lab/dossier-upload-table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Data fetching ───────────────────────────────────────────────────

async function getRuns(): Promise<EvaluationRun[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("evaluation_runs")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) { console.error("Failed to fetch runs:", error); return []; }
  return (data ?? []) as EvaluationRun[];
}

type DossierRow = {
  id: string;
  plan_file_name: string | null;
  calculation_file_name: string | null;
  address: string | null;
  postcode: string | null;
};

/** Latest evaluation result per dossier (best cost_error_pct across runs) */
type DossierAccuracy = {
  dossier_id: string;
  cost_error_pct: number | null;
  cat1_error_pct: number | null;
  cat2_error_pct: number | null;
  cat3_error_pct: number | null;
  predicted_total_cost: number | null;
  error_message: string | null;
  run_name: string;
  run_date: string;
};

async function getDossiers(): Promise<DossierRow[]> {
  const admin = createSupabaseAdminClient();
  // Try with calculation_file_name; fall back without it if column doesn't exist yet
  let { data, error } = await admin
    .from("reference_dossiers")
    .select("id, plan_file_name, calculation_file_name, address, postcode")
    .order("created_at", { ascending: false });
  if (error?.code === "42703") {
    const fallback = await admin
      .from("reference_dossiers")
      .select("id, plan_file_name, address, postcode")
      .order("created_at", { ascending: false });
    data = (fallback.data ?? []).map((d) => ({ ...d, calculation_file_name: null })) as typeof data;
    error = fallback.error;
  }
  if (error) { console.error("Failed to fetch dossiers:", error); return []; }
  return (data ?? []) as DossierRow[];
}

async function getLatestResults(): Promise<Record<string, DossierAccuracy>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("evaluation_results")
    .select("dossier_id, cost_error_pct, cat1_error_pct, cat2_error_pct, cat3_error_pct, predicted_total_cost, error_message, evaluation_runs!inner(name, started_at)")
    .order("created_at", { ascending: false });
  if (error) { console.error("Failed to fetch results:", error); return {}; }

  // Keep only the latest result per dossier
  const map: Record<string, DossierAccuracy> = {};
  for (const row of data ?? []) {
    const did = row.dossier_id as string;
    if (map[did]) continue; // already have a newer result
    const run = row.evaluation_runs as unknown as { name: string; started_at: string };
    map[did] = {
      dossier_id: did,
      cost_error_pct: row.cost_error_pct as number | null,
      cat1_error_pct: row.cat1_error_pct as number | null,
      cat2_error_pct: row.cat2_error_pct as number | null,
      cat3_error_pct: row.cat3_error_pct as number | null,
      predicted_total_cost: row.predicted_total_cost as number | null,
      error_message: row.error_message as string | null,
      run_name: run.name,
      run_date: run.started_at,
    };
  }
  return map;
}

async function getGroundTruth(): Promise<(GroundTruth & { plan_file_name: string | null })[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("benchmark_ground_truth")
    .select("*, reference_dossiers!inner(plan_file_name)")
    .order("created_at", { ascending: false });
  if (error) { console.error("Failed to fetch ground truth:", error); return []; }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    plan_file_name: (row.reference_dossiers as { plan_file_name: string | null })?.plan_file_name ?? null,
  })) as (GroundTruth & { plan_file_name: string | null })[];
}

// ── Components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "complete") return <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Complete</span>;
  if (status === "failed") return <span className="inline-flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3 w-3" /> Failed</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Loader2 className="h-3 w-3 animate-spin" /> Running</span>;
}

function fmt(n: number | null | undefined, suffix = "%"): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}${suffix}`;
}

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

// ── Page ────────────────────────────────────────────────────────────

export default async function BenchmarkPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab ?? "runs";
  const [runs, groundTruth, dossiers, latestResults] = await Promise.all([getRuns(), getGroundTruth(), getDossiers(), getLatestResults()]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prompt Lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Evaluate pipeline accuracy against expert ground truth. Run tests, review results, iterate on prompts.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <Link
          href="/admin/prompt-lab?tab=runs"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "runs" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Runs ({runs.length})
        </Link>
        <Link
          href="/admin/prompt-lab?tab=dossiers"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "dossiers" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Dossiers ({dossiers.length})
        </Link>
        <Link
          href="/admin/prompt-lab?tab=ground-truth"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "ground-truth" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Ground Truth ({groundTruth.length})
        </Link>
      </div>

      {tab === "runs" && (
        <>
        <StartRunButton />
        <Card>
          {runs.length === 0 ? (
            <CardContent className="py-12">
              <div className="text-center text-sm text-muted-foreground">
                No benchmark runs yet. Click &quot;Start Run&quot; above to evaluate the pipeline.
              </div>
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-right font-medium">Dossiers</th>
                    <th className="px-4 py-3 text-right font-medium">Cost MAE</th>
                    <th className="px-4 py-3 text-right font-medium">Cost Median</th>
                    <th className="px-4 py-3 text-right font-medium">&lt; 15%</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/admin/prompt-lab/${run.id}`} className="font-medium text-primary hover:underline">
                          {run.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">{run.dossier_count}</td>
                      <td className="px-4 py-3 text-right">{fmt(run.metrics?.cost_mae_pct)}</td>
                      <td className="px-4 py-3 text-right">{fmt(run.metrics?.cost_median_pct)}</td>
                      <td className="px-4 py-3 text-right">{fmt(run.metrics?.cost_within_15_pct ? run.metrics.cost_within_15_pct * 100 : null)}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={run.status} /></td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {new Date(run.started_at).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </>
      )}

      {tab === "dossiers" && (
        <Card>
          <CardHeader>
            <CardTitle>Dossier files</CardTitle>
            <CardDescription>
              Upload plan (→ LLM extraction) and calculation (→ ground truth comparison) per dossier.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <DossierUploadTable dossiers={dossiers} latestResults={latestResults} />
          </CardContent>
        </Card>
      )}

      {tab === "ground-truth" && (
        <>
        <ExtractGroundTruthButton />
        <Card>
          {groundTruth.length === 0 ? (
            <CardContent className="py-12">
              <div className="text-center text-sm text-muted-foreground">
                No ground truth extracted yet. Upload dossiers in &quot;Dossiers&quot; first, then click &quot;Extract Ground Truth&quot; above.
              </div>
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Dossier</th>
                    <th className="px-4 py-3 text-right font-medium">Expert price</th>
                    <th className="px-4 py-3 text-right font-medium">Cat1 m²</th>
                    <th className="px-4 py-3 text-right font-medium">Cat2 m²</th>
                    <th className="px-4 py-3 text-right font-medium">Cat3 m²</th>
                    <th className="px-4 py-3 text-right font-medium">Confidence</th>
                    <th className="px-4 py-3 text-right font-medium">Latest cost Δ</th>
                    <th className="px-4 py-3 text-center font-medium">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {groundTruth.map((gt) => (
                    <tr key={gt.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/admin/prompt-lab/dossier/${gt.dossier_id}`} className="text-primary hover:underline">
                          {gt.plan_file_name || gt.dossier_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">{fmtEur(gt.expert_total_price)}</td>
                      <td className="px-4 py-3 text-right">{gt.expert_cat1_sqm?.toFixed(1) ?? "—"}</td>
                      <td className="px-4 py-3 text-right">{gt.expert_cat2_sqm?.toFixed(1) ?? "—"}</td>
                      <td className="px-4 py-3 text-right">{gt.expert_cat3_sqm?.toFixed(1) ?? "—"}</td>
                      <td className="px-4 py-3 text-right">{gt.extraction_confidence?.toFixed(2) ?? "—"}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", (() => {
                        const r = latestResults[gt.dossier_id];
                        if (!r || r.error_message || r.cost_error_pct == null) return "text-muted-foreground";
                        const abs = Math.abs(r.cost_error_pct);
                        if (abs <= 10) return "text-green-600";
                        if (abs <= 20) return "text-amber-600";
                        return "text-red-600";
                      })())}>
                        {(() => {
                          const r = latestResults[gt.dossier_id];
                          if (!r) return "—";
                          if (r.error_message) return "Error";
                          if (r.cost_error_pct == null) return "—";
                          return `${r.cost_error_pct > 0 ? "+" : ""}${r.cost_error_pct.toFixed(1)}%`;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {gt.verified ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" /> : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </>
      )}
    </div>
  );
}
