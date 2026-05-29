// src/app/(dashboard)/admin/prompt-lab/page.tsx
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExtractGroundTruthButton } from "@/components/prompt-lab/extract-gt-button";
import { StartRunButton } from "@/components/prompt-lab/start-run-button";
import { DossierUploadTable } from "@/components/prompt-lab/dossier-upload-table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Data fetching ───────────────────────────────────────────────────

type DossierRow = {
  id: string;
  plan_file_name: string | null;
  calculation_file_name: string | null;
  address: string | null;
  postcode: string | null;
};

/** Latest evaluation result per dossier */
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

/** Ground-truth presence + expert total per dossier */
type GtInfo = { expert_total_price: number | null };

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

async function getGroundTruthMap(): Promise<Record<string, GtInfo>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("benchmark_ground_truth")
    .select("dossier_id, expert_total_price");
  if (error) { console.error("Failed to fetch ground truth:", error); return {}; }
  const map: Record<string, GtInfo> = {};
  for (const row of data ?? []) {
    map[row.dossier_id as string] = { expert_total_price: row.expert_total_price as number | null };
  }
  return map;
}

// ── Page ────────────────────────────────────────────────────────────

export default async function PromptLabPage() {
  const [dossiers, latestResults, groundTruth] = await Promise.all([
    getDossiers(),
    getLatestResults(),
    getGroundTruthMap(),
  ]);

  const gtCount = Object.keys(groundTruth).length;
  const testedCount = Object.values(latestResults).filter((r) => !r.error_message).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prompt Lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Eén plan → SQM + QQP → kost, vergeleken met de CED-expert. Upload, extraheer expert-data, test en bekijk de afwijking per dossier.
        </p>
      </div>

      {/* Toolbar — batch actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Batch test (alle dossiers met expert-data)</CardTitle>
          </CardHeader>
          <CardContent>
            <StartRunButton />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Expert-data extractie (alle zonder expert)</CardTitle>
          </CardHeader>
          <CardContent>
            <ExtractGroundTruthButton />
          </CardContent>
        </Card>
      </div>

      {/* Dossiers — the single hub */}
      <Card>
        <CardHeader>
          <CardTitle>
            Dossiers ({dossiers.length}) · {gtCount} met expert-data · {testedCount} getest
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Upload plan (→ LLM) en berekening (→ CED expert). Klik een dossier voor de pipeline-walkthrough + AI-analyse.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <DossierUploadTable
            dossiers={dossiers}
            latestResults={latestResults}
            groundTruth={groundTruth}
          />
        </CardContent>
      </Card>
    </div>
  );
}
