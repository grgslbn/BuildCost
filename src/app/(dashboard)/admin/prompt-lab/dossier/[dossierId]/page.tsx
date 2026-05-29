import { createSupabaseAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrossRunTable } from "@/components/prompt-lab/cross-run-table";
import { DossierAnnotations } from "@/components/prompt-lab/dossier-annotations";
import { DossierTester } from "@/components/prompt-lab/dossier-tester";
import { DossierChat } from "@/components/prompt-lab/dossier-chat";
import { DossierNavKeys } from "@/components/prompt-lab/dossier-nav-keys";
import { PipelineWalkthrough } from "@/components/prompt-lab/pipeline-walkthrough";
import type { SqmExtraction } from "@/components/prompt-lab/extraction-details";
import type { PricingConfig } from "@/lib/cost/calculate-cost";
import type { BenchmarkAnnotation } from "@/lib/prompt-lab/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

export default async function DossierDetailPage({
  params,
}: {
  params: { dossierId: string };
}) {
  const admin = createSupabaseAdminClient();
  const { dossierId } = params;

  // Fetch dossier
  let { data: dossier, error: dossierErr } = await admin
    .from("reference_dossiers")
    .select("id, plan_file_name, calculation_file_name, calculation_storage_path, address, postcode, building_type, known_total_price, expert_finishing_level")
    .eq("id", dossierId)
    .single();
  if (dossierErr?.code === "42703") {
    const fb = await admin
      .from("reference_dossiers")
      .select("id, plan_file_name, address, postcode, building_type, known_total_price, expert_finishing_level")
      .eq("id", dossierId)
      .single();
    dossier = fb.data ? { ...fb.data, calculation_file_name: null, calculation_storage_path: null } as typeof dossier : null;
  }

  if (!dossier) {
    return <div className="p-8 text-center text-muted-foreground">Dossier not found.</div>;
  }

  // Fetch prev/next dossier for navigation
  const { data: allDossierIds } = await admin
    .from("reference_dossiers")
    .select("id")
    .order("created_at", { ascending: false });
  const ids = (allDossierIds ?? []).map((d) => d.id);
  const currentIdx = ids.indexOf(dossierId);
  const prevId = currentIdx > 0 ? ids[currentIdx - 1] : null;
  const nextId = currentIdx < ids.length - 1 ? ids[currentIdx + 1] : null;

  // Fetch ground truth
  const { data: gt } = await admin
    .from("benchmark_ground_truth")
    .select("*")
    .eq("dossier_id", dossierId)
    .maybeSingle();

  // Fetch cross-run results with run info
  const { data: results } = await admin
    .from("evaluation_results")
    .select("*, evaluation_runs!inner(id, name, started_at)")
    .eq("dossier_id", dossierId)
    .order("created_at", { ascending: false });

  const crossRunResults = (results ?? []).map((r: Record<string, unknown>) => {
    const run = r.evaluation_runs as { id: string; name: string; started_at: string };
    return {
      run_id: run.id,
      run_name: run.name,
      run_date: run.started_at,
      extracted_cat1_sqm: r.extracted_cat1_sqm as number | null,
      extracted_cat2_sqm: r.extracted_cat2_sqm as number | null,
      extracted_cat3_sqm: r.extracted_cat3_sqm as number | null,
      cat1_error_pct: r.cat1_error_pct as number | null,
      cat2_error_pct: r.cat2_error_pct as number | null,
      cat3_error_pct: r.cat3_error_pct as number | null,
      predicted_total_cost: r.predicted_total_cost as number | null,
      cost_error_pct: r.cost_error_pct as number | null,
      predicted_f: r.predicted_f as number | null,
      expert_f: r.expert_f as number | null,
      f_error: r.f_error as number | null,
      error_message: r.error_message as string | null,
      sqm_extraction: r.sqm_extraction as Record<string, unknown> | null,
      extracted_qqps: r.extracted_qqps as Record<string, { score: number; confidence?: number; reasoning?: string }> | null,
    };
  });

  // Fetch annotations
  let annotations: Record<string, unknown>[] | null = null;
  const { data: annData, error: annErr } = await admin
    .from("benchmark_annotations")
    .select("*")
    .eq("dossier_id", dossierId)
    .order("created_at", { ascending: false });
  if (!annErr) annotations = annData;

  // Pricing config (same source/defaults as the pipeline) for unit-price derivation
  const { data: settingsRows } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", [
      "cat1_price_min", "cat1_price_max",
      "cat2_price_min", "cat2_price_max",
      "cat3_price_min", "cat3_price_max",
    ]);
  const settings = Object.fromEntries((settingsRows ?? []).map((s) => [s.key, s.value]));
  const pricing: PricingConfig = {
    cat1_min: (settings.cat1_price_min as number) ?? 1100,
    cat1_max: (settings.cat1_price_max as number) ?? 1900,
    cat2_min: (settings.cat2_price_min as number) ?? 550,
    cat2_max: (settings.cat2_price_max as number) ?? 950,
    cat3_min: (settings.cat3_price_min as number) ?? 330,
    cat3_max: (settings.cat3_price_max as number) ?? 570,
  };

  // QQP definitions grouped by category — for labelling/grouping the QQP scores
  const [{ data: qqpCats }, { data: qqpDefs }] = await Promise.all([
    admin.from("qqp_categories").select("id, name, display_name, sort_order").order("sort_order"),
    admin.from("qqp_definitions").select("id, category_id, name, display_name, weight, sort_order, is_active").eq("is_active", true).order("sort_order"),
  ]);
  const qqpGroups = (qqpCats ?? []).map((c) => ({
    categoryName: c.name as string,
    displayName: c.display_name as string,
    items: (qqpDefs ?? [])
      .filter((d) => d.category_id === c.id)
      .map((d) => ({
        name: d.name as string,
        displayName: d.display_name as string,
        weight: (d.weight as number | null) ?? null,
      })),
  }));

  const hasCalculation = !!dossier.calculation_storage_path;

  // Get latest successful result to pre-populate the tester
  const latestSuccessful = crossRunResults.find((r) => !r.error_message && r.predicted_total_cost != null);
  const initialResult = latestSuccessful
    ? {
        cat1_sqm: latestSuccessful.extracted_cat1_sqm,
        cat2_sqm: latestSuccessful.extracted_cat2_sqm,
        cat3_sqm: latestSuccessful.extracted_cat3_sqm,
        total_cost: latestSuccessful.predicted_total_cost,
        processing_time_ms: null as number | null,
      }
    : null;

  const initialGt = gt
    ? {
        expert_total_price: gt.expert_total_price as number | null,
        expert_cat1_sqm: gt.expert_cat1_sqm as number | null,
        expert_cat2_sqm: gt.expert_cat2_sqm as number | null,
        expert_cat3_sqm: gt.expert_cat3_sqm as number | null,
        expert_finishing_level: gt.expert_finishing_level as string | null,
        extraction_confidence: gt.extraction_confidence as number | null,
      }
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <DossierNavKeys prevId={prevId} nextId={nextId} />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/prompt-lab?tab=dossiers" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {dossier.plan_file_name || dossierId.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[dossier.address, dossier.postcode, dossier.building_type].filter(Boolean).join(" · ") || "No address data"}
            {currentIdx >= 0 && <span className="ml-2">({currentIdx + 1} / {ids.length})</span>}
          </p>
        </div>
        {/* Prev / Next navigation */}
        <div className="flex items-center gap-1">
          {prevId ? (
            <Link
              href={`/admin/prompt-lab/dossier/${prevId}`}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Prev
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-muted-foreground/40 cursor-not-allowed">
              <ArrowLeft className="h-3.5 w-3.5" />
              Prev
            </span>
          )}
          {nextId ? (
            <Link
              href={`/admin/prompt-lab/dossier/${nextId}`}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-muted-foreground/40 cursor-not-allowed">
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>

      {/* Files + Ground Truth — compact row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {dossier.plan_file_name ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span>Plan: {dossier.plan_file_name || "Missing"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {dossier.calculation_file_name ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span>Calculation: {dossier.calculation_file_name || "Missing"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Expert (CED)</CardTitle>
          </CardHeader>
          <CardContent>
            {gt ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Total price: <span className="font-medium">{fmtEur(gt.expert_total_price)}</span></div>
                <div>Finishing: <span className="font-medium">{gt.expert_finishing_level || "—"}</span></div>
                <div>Cat1: <span className="font-medium">{gt.expert_cat1_sqm?.toFixed(1) ?? "—"} m²</span></div>
                <div>Cat2: <span className="font-medium">{gt.expert_cat2_sqm?.toFixed(1) ?? "—"} m²</span></div>
                <div>Cat3: <span className="font-medium">{gt.expert_cat3_sqm?.toFixed(1) ?? "—"} m²</span></div>
                <div>Confidence: <span className="font-medium">{gt.extraction_confidence?.toFixed(2) ?? "—"}</span></div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {hasCalculation
                  ? "Not extracted yet — click Test to auto-extract."
                  : "No calculation file uploaded."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline walkthrough — plan → SQM → QQP → eenheidsprijs → totale kost */}
      {latestSuccessful && (
        <Card>
          <CardHeader>
            <CardTitle>Pipeline: plan → SQM → QQP → kost (vs CED expert)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Stap-voor-stap van de laatste LLM-extractie, elke stap vergeleken met de expertberekening.
            </p>
          </CardHeader>
          <CardContent>
            <PipelineWalkthrough
              data={{
                planFileName: dossier.plan_file_name ?? null,
                buildingCount:
                  (latestSuccessful.sqm_extraction as { buildings?: unknown[] } | null)?.buildings?.length ?? null,
                llm_cat1_sqm: latestSuccessful.extracted_cat1_sqm,
                llm_cat2_sqm: latestSuccessful.extracted_cat2_sqm,
                llm_cat3_sqm: latestSuccessful.extracted_cat3_sqm,
                predicted_f: latestSuccessful.predicted_f,
                expert_f: latestSuccessful.expert_f,
                predicted_total_cost: latestSuccessful.predicted_total_cost,
                sqmExtraction: latestSuccessful.sqm_extraction as SqmExtraction | null,
                qqpScores: latestSuccessful.extracted_qqps,
                qqpGroups,
                pricing,
                gt: gt
                  ? {
                      expert_cat1_sqm: gt.expert_cat1_sqm as number | null,
                      expert_cat2_sqm: gt.expert_cat2_sqm as number | null,
                      expert_cat3_sqm: gt.expert_cat3_sqm as number | null,
                      expert_total_price: gt.expert_total_price as number | null,
                      expert_finishing_level: gt.expert_finishing_level as string | null,
                    }
                  : null,
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Test dossier — main action area */}
      <Card>
        <CardHeader>
          <CardTitle>Test Pipeline</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sends the plan to the LLM for extraction, then compares with expert calculation.
          </p>
        </CardHeader>
        <CardContent>
          <DossierTester
            dossierId={dossierId}
            hasCalculation={hasCalculation}
            initialGt={initialGt}
            initialResult={initialResult}
          />
        </CardContent>
      </Card>

      {/* AI Chat — for deeper analysis */}
      <Card>
        <CardHeader>
          <CardTitle>AI Chat</CardTitle>
          <p className="text-sm text-muted-foreground">
            Chat with AI about extraction results, prompt issues, or plan details.
          </p>
        </CardHeader>
        <CardContent>
          <DossierChat dossierId={dossierId} />
        </CardContent>
      </Card>

      {/* Cross-run comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Results per run</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <CrossRunTable results={crossRunResults} />
        </CardContent>
      </Card>

      {/* Annotations */}
      <Card>
        <CardHeader>
          <CardTitle>Annotations</CardTitle>
        </CardHeader>
        <CardContent>
          <DossierAnnotations
            dossierId={dossierId}
            initial={(annotations ?? []) as BenchmarkAnnotation[]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
