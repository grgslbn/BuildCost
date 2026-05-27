import { createSupabaseAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrossRunTable } from "@/components/prompt-lab/cross-run-table";
import { DossierAnnotations } from "@/components/prompt-lab/dossier-annotations";
import { DossierChat } from "@/components/prompt-lab/dossier-chat";
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

  // Fetch dossier — fall back without calculation_file_name if column doesn't exist yet
  let { data: dossier, error: dossierErr } = await admin
    .from("reference_dossiers")
    .select("id, plan_file_name, calculation_file_name, address, postcode, building_type, known_total_price, expert_finishing_level")
    .eq("id", dossierId)
    .single();
  if (dossierErr?.code === "42703") {
    const fb = await admin
      .from("reference_dossiers")
      .select("id, plan_file_name, address, postcode, building_type, known_total_price, expert_finishing_level")
      .eq("id", dossierId)
      .single();
    dossier = fb.data ? { ...fb.data, calculation_file_name: null } as typeof dossier : null;
  }

  if (!dossier) {
    return <div className="p-8 text-center text-muted-foreground">Dossier niet gevonden.</div>;
  }

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
    };
  });

  // Fetch annotations — table may not exist yet before migration
  let annotations: Record<string, unknown>[] | null = null;
  const { data: annData, error: annErr } = await admin
    .from("benchmark_annotations")
    .select("*")
    .eq("dossier_id", dossierId)
    .order("created_at", { ascending: false });
  if (!annErr) annotations = annData;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/prompt-lab?tab=dossiers" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {dossier.plan_file_name || dossierId.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[dossier.address, dossier.postcode, dossier.building_type].filter(Boolean).join(" · ") || "Geen adresgegevens"}
          </p>
        </div>
      </div>

      {/* File status + Ground truth */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bestanden</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {dossier.plan_file_name ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span>Plan: {dossier.plan_file_name || "Ontbreekt"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {dossier.calculation_file_name ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span>Berekening: {dossier.calculation_file_name || "Ontbreekt"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ground Truth (Expert)</CardTitle>
          </CardHeader>
          <CardContent>
            {gt ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Totaalprijs: <span className="font-medium">{fmtEur(gt.expert_total_price)}</span></div>
                <div>Afwerking: <span className="font-medium">{gt.expert_finishing_level || "—"}</span></div>
                <div>Cat1: <span className="font-medium">{gt.expert_cat1_sqm?.toFixed(1) ?? "—"} m²</span></div>
                <div>Cat2: <span className="font-medium">{gt.expert_cat2_sqm?.toFixed(1) ?? "—"} m²</span></div>
                <div>Cat3: <span className="font-medium">{gt.expert_cat3_sqm?.toFixed(1) ?? "—"} m²</span></div>
                <div>Vertrouwen: <span className="font-medium">{gt.extraction_confidence?.toFixed(2) ?? "—"}</span></div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nog geen ground truth geëxtraheerd.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Chat */}
      <Card>
        <CardHeader>
          <CardTitle>AI Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <DossierChat dossierId={dossierId} />
        </CardContent>
      </Card>

      {/* Cross-run comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Resultaten per run</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <CrossRunTable results={crossRunResults} />
        </CardContent>
      </Card>

      {/* Annotations */}
      <Card>
        <CardHeader>
          <CardTitle>Annotaties</CardTitle>
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
