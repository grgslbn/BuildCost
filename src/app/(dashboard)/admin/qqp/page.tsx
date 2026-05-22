import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalibrateButton } from "@/components/qqp/calibrate-button";
import { ReExtractButton } from "@/components/qqp/re-extract-button";
import { ProposedQQPActions } from "@/components/qqp/proposed-qqp-actions";
import { ToggleActiveButton } from "@/components/qqp/toggle-active-button";

export const dynamic = "force-dynamic";

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchPageData() {
  const admin = createSupabaseAdminClient();

  const [
    qqpDefsRes,
    qqpCatsRes,
    qqpCountsRes,
    discoveryRes,
    modelVersionsRes,
    totalDossiersRes,
  ] = await Promise.all([
    admin
      .from("qqp_definitions")
      .select("id, name, display_name, description, data_type, unit, weight, weight_confidence, discovery_source, is_active, discovery_count, category_id, sort_order")
      .order("sort_order"),
    admin
      .from("qqp_categories")
      .select("id, name, display_name")
      .order("sort_order"),
    admin
      .from("dossier_qqp_values")
      .select("qqp_id"),
    // Proposed QQPs grouped — we fetch all and aggregate in JS
    admin
      .from("qqp_discovery_log")
      .select("proposed_name, proposed_description, reasoning, dossier_id, prediction_residual")
      .eq("status", "proposed")
      .order("created_at", { ascending: false }),
    admin
      .from("qqp_model_versions")
      .select("id, version, training_dossier_count, accuracy_metrics, notes, is_active, created_at")
      .order("version", { ascending: false })
      .limit(10),
    admin
      .from("reference_dossiers")
      .select("id", { count: "exact", head: true })
      .eq("status", "analyzed"),
  ]);

  // Count dossiers per QQP
  const qqpDossierCounts = new Map<string, number>();
  for (const v of qqpCountsRes.data ?? []) {
    qqpDossierCounts.set(v.qqp_id, (qqpDossierCounts.get(v.qqp_id) ?? 0) + 1);
  }

  // Build category map
  const catMap = new Map(
    (qqpCatsRes.data ?? []).map((c) => [c.id, c.display_name])
  );

  // Aggregate proposed QQPs
  type ProposedGroup = {
    name: string;
    count: number;
    description: string | null;
    latestReasoning: string | null;
    avgResidual: number | null;
  };
  const proposedMap = new Map<string, ProposedGroup>();
  for (const row of discoveryRes.data ?? []) {
    if (!proposedMap.has(row.proposed_name)) {
      proposedMap.set(row.proposed_name, {
        name: row.proposed_name,
        count: 0,
        description: row.proposed_description,
        latestReasoning: row.reasoning,
        avgResidual: null,
      });
    }
    const g = proposedMap.get(row.proposed_name)!;
    g.count += 1;
    if (row.reasoning) g.latestReasoning = row.reasoning;
    if (row.proposed_description) g.description = row.proposed_description;
  }
  const proposed = Array.from(proposedMap.values()).sort((a, b) => b.count - a.count);

  return {
    qqpDefs: (qqpDefsRes.data ?? []).map((d) => ({
      ...d,
      categoryName: catMap.get(d.category_id ?? "") ?? null,
      dossierCount: qqpDossierCounts.get(d.id) ?? 0,
    })),
    proposed,
    modelVersions: modelVersionsRes.data ?? [],
    totalAnalyzed: totalDossiersRes.count ?? 0,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function WeightBar({ weight, confidence }: { weight: number; confidence: number }) {
  const pct = Math.abs(weight) * 100;
  const isPositive = weight >= 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-2 rounded-full transition-all ${
            isPositive ? "bg-green-500" : "bg-red-500"
          }`}
          style={{
            width: `${pct}%`,
            opacity: 0.4 + confidence * 0.6,
          }}
        />
      </div>
      <span className="min-w-[3.5rem] text-right font-mono text-xs text-muted-foreground">
        {weight >= 0 ? "+" : ""}
        {weight.toFixed(3)}
      </span>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (source === "ai_discovered")
    return (
      <Badge variant="secondary" className="text-xs">
        AI discovered
      </Badge>
    );
  if (source === "expert_added")
    return (
      <Badge variant="outline" className="text-xs">
        Expert added
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      Seeded
    </Badge>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminQQPPage() {
  const { qqpDefs, proposed, modelVersions, totalAnalyzed } =
    await fetchPageData();

  const activeDefs = qqpDefs.filter((d) => d.is_active);
  const inactiveDefs = qqpDefs.filter((d) => !d.is_active);
  const latestModel = modelVersions[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">QQP Model</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage finishing-level parameters, weights, and model versions.
            {totalAnalyzed > 0 && (
              <span className="ml-1">
                {totalAnalyzed} analyzed dossier
                {totalAnalyzed !== 1 ? "s" : ""} in training corpus.
              </span>
            )}
          </p>
        </div>
        <div className="flex items-start gap-3">
          <CalibrateButton />
          <ReExtractButton />
        </div>
      </div>

      {/* Latest model summary */}
      {latestModel && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Active model — v{latestModel.version}
            </CardTitle>
            <CardDescription>
              Trained on {latestModel.training_dossier_count ?? "—"} dossiers ·{" "}
              {formatDate(latestModel.created_at)}
              {latestModel.accuracy_metrics && (
                <>
                  {" · "}
                  MAE:{" "}
                  {(latestModel.accuracy_metrics as { mae?: number }).mae?.toFixed(3) ?? "—"}
                  {" · "}
                  R²:{" "}
                  {(latestModel.accuracy_metrics as { r_squared?: number }).r_squared?.toFixed(3) ?? "—"}
                </>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Separator />

      {/* Section A: Active QQPs */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Active QQPs</h2>
          <p className="text-sm text-muted-foreground">
            {activeDefs.length} active parameter
            {activeDefs.length !== 1 ? "s" : ""} used in finishing level extraction.
          </p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead className="text-right">Dossiers</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-[60px] text-center">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeDefs.map((def) => (
                <TableRow key={def.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{def.display_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {def.name}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {def.categoryName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {def.data_type}
                      {def.unit ? ` · ${def.unit}` : ""}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <WeightBar
                      weight={Number(def.weight ?? 0)}
                      confidence={Number(def.weight_confidence ?? 0)}
                    />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {def.dossierCount > 0 ? (
                      def.dossierCount
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <SourceBadge source={def.discovery_source ?? "seeded"} />
                  </TableCell>
                  <TableCell className="text-center">
                    <ToggleActiveButton qqpId={def.id} isActive={def.is_active} />
                  </TableCell>
                </TableRow>
              ))}
              {activeDefs.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No active QQPs.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Inactive QQPs collapsible */}
        {inactiveDefs.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
              <span className="underline underline-offset-4">
                {inactiveDefs.length} inactive QQP
                {inactiveDefs.length !== 1 ? "s" : ""}
              </span>
            </summary>
            <div className="mt-2 rounded-md border opacity-60">
              <Table>
                <TableBody>
                  {inactiveDefs.map((def) => (
                    <TableRow key={def.id} className="hover:bg-transparent">
                      <TableCell className="w-[200px]">
                        <p className="text-sm font-medium text-muted-foreground">
                          {def.display_name}
                        </p>
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={def.discovery_source ?? "seeded"} />
                      </TableCell>
                      <TableCell>
                        <ToggleActiveButton qqpId={def.id} isActive={def.is_active} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </div>

      <Separator />

      {/* Section B: Proposed QQPs */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Proposed QQPs</h2>
          <p className="text-sm text-muted-foreground">
            AI-suggested parameters not yet activated. Accept to create a new QQP
            definition; reject to dismiss.
          </p>
        </div>
        {proposed.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No pending proposals. Process more dossiers to generate suggestions.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Proposed name</TableHead>
                  <TableHead className="text-right w-[80px]">Proposed by</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Latest reasoning</TableHead>
                  <TableHead className="w-[140px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposed.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell>
                      <span className="font-mono text-sm">{p.name}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {p.count} dossier{p.count !== 1 ? "s" : ""}
                    </TableCell>
                    <TableCell className="max-w-[200px] text-sm text-muted-foreground">
                      <p className="line-clamp-2">{p.description ?? "—"}</p>
                    </TableCell>
                    <TableCell className="max-w-[240px] text-sm text-muted-foreground">
                      <p className="line-clamp-2">{p.latestReasoning ?? "—"}</p>
                    </TableCell>
                    <TableCell>
                      <ProposedQQPActions proposedName={p.name} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Separator />

      {/* Section C: Model versions */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Model versions</h2>
          <p className="text-sm text-muted-foreground">
            History of weight calibration runs. The latest version is used for
            re-evaluating dossiers.
          </p>
        </div>
        {modelVersions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No model versions yet. Click &ldquo;Calibrate Weights Now&rdquo; to create the
            first.
          </p>
        ) : (
          <div className="space-y-2">
            {modelVersions.map((v) => {
              const metrics = v.accuracy_metrics as {
                mae?: number;
                rmse?: number;
                r_squared?: number;
                n_predictions?: number;
              } | null;
              return (
                <details key={v.id} className="rounded-md border">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 hover:bg-muted/30">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">v{v.version}</span>
                      {v.is_active && (
                        <Badge className="text-xs">Active</Badge>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {v.training_dossier_count ?? "—"} dossiers ·{" "}
                        {formatDate(v.created_at)}
                      </span>
                    </div>
                    {metrics && (
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        <span>MAE {metrics.mae?.toFixed(3) ?? "—"}</span>
                        <span>RMSE {metrics.rmse?.toFixed(3) ?? "—"}</span>
                        <span>R² {metrics.r_squared?.toFixed(3) ?? "—"}</span>
                        {metrics.n_predictions != null && (
                          <span>{metrics.n_predictions} predictions</span>
                        )}
                      </div>
                    )}
                  </summary>
                  {v.notes && (
                    <div className="border-t px-4 py-3">
                      <p className="text-xs text-muted-foreground">{v.notes}</p>
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
