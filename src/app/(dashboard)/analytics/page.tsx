import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LearningCurveChart, type ModelVersionPoint } from "@/components/analytics/learning-curve-chart";
import { AnalyticsControls } from "@/components/analytics/auto-refresh";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivityEvent = {
  id: string;
  time: Date;
  eventType: string;
  details: string;
  badge: "ok" | "pending" | "error";
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ProgressBar({
  value,
  color = "bg-primary",
}: {
  value: number;
  color?: string;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: "red" | "green" | "amber";
}) {
  const valueClass =
    accent === "red"
      ? "text-destructive"
      : accent === "green"
      ? "text-green-600"
      : accent === "amber"
      ? "text-amber-600"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: "ok" | "pending" | "error" }) {
  if (status === "ok")
    return <Badge className="text-xs bg-green-100 text-green-800 hover:bg-green-100">ok</Badge>;
  if (status === "error")
    return <Badge variant="destructive" className="text-xs">error</Badge>;
  return <Badge variant="secondary" className="text-xs">pending</Badge>;
}

function WeightBar({ weight, confidence }: { weight: number; confidence: number }) {
  const pct = Math.min(100, Math.abs(weight) * 100);
  const color = weight >= 0 ? "bg-green-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%`, opacity: 0.4 + confidence * 0.6 }}
        />
      </div>
      <span className="min-w-[3rem] text-right font-mono text-xs text-muted-foreground">
        {weight >= 0 ? "+" : ""}
        {weight.toFixed(3)}
      </span>
    </div>
  );
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchData() {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const minus24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    dossiersStatusRes,
    completedEstimationsRes,
    latestModelRes,
    activeQQPDefsRes,
    pricedCountRes,
    predErrorsRes,
    allModelVersionsRes,
    settingsRes,
    proposedQQPsRes,
    apiCallsTodayRes,
    estTimesRes,
    dosTimesRes,
    errors24hDosRes,
    errors24hEstRes,
    fileCountRes,
    recentDossiersRes,
    recentEstimationsRes,
    recentDiscoveryRes,
    recentModelVersRes,
    recentApiErrorsRes,
  ] = await Promise.all([
    // Overview
    admin.from("reference_dossiers").select("status"),
    admin.from("estimations").select("id", { count: "exact", head: true }).eq("status", "complete"),
    admin
      .from("qqp_model_versions")
      .select("id, version, accuracy_metrics, training_dossier_count, is_active, created_at")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("qqp_definitions")
      .select("name, display_name, weight, weight_confidence, discovery_source")
      .eq("is_active", true)
      .order("sort_order"),

    // Training progress
    admin
      .from("reference_dossiers")
      .select("id", { count: "exact", head: true })
      .not("known_price_per_sqm", "is", null),
    admin.from("reference_dossiers").select("prediction_error").not("prediction_error", "is", null),
    admin
      .from("qqp_model_versions")
      .select("version, accuracy_metrics, training_dossier_count, created_at")
      .order("version", { ascending: true }),
    admin
      .from("system_settings")
      .select("key, value")
      .in("key", ["qqp_discovery_threshold", "calibration_interval"]),

    // QQP discovery
    admin
      .from("qqp_discovery_log")
      .select("proposed_name, proposed_description, dossier_id")
      .eq("status", "proposed"),

    // System health
    admin.from("api_call_log").select("call_type, status").gte("created_at", startOfDay),
    admin.from("estimations").select("processing_time_ms").not("processing_time_ms", "is", null),
    admin
      .from("reference_dossiers")
      .select("processing_time_ms")
      .not("processing_time_ms", "is", null),
    admin
      .from("reference_dossiers")
      .select("id", { count: "exact", head: true })
      .eq("status", "error")
      .gte("updated_at", minus24h),
    admin
      .from("estimations")
      .select("id", { count: "exact", head: true })
      .eq("status", "error")
      .gte("updated_at", minus24h),
    admin
      .from("reference_dossiers")
      .select("id", { count: "exact", head: true })
      .not("plan_storage_path", "is", null),

    // Activity feed
    admin
      .from("reference_dossiers")
      .select("id, plan_file_name, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(10),
    admin
      .from("estimations")
      .select("id, plan_file_name, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(6),
    admin
      .from("qqp_discovery_log")
      .select("id, proposed_name, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("qqp_model_versions")
      .select("id, version, created_at")
      .order("created_at", { ascending: false })
      .limit(3),
    admin
      .from("api_call_log")
      .select("id, call_type, error_message, created_at")
      .eq("status", "error")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // ── Section 1 ───────────────────────────────────────────────────────────────
  const dossierStatuses = (dossiersStatusRes.data ?? []).map(
    (d: { status: string }) => d.status
  );
  const totalDossiers = dossierStatuses.length;
  const analyzedCount = dossierStatuses.filter(
    (s: string) => s === "analyzed" || s === "validated"
  ).length;
  const processingStatuses = ["pending", "extracting_sqm", "sqm_done", "extracting_qqp"];
  const pendingCount = dossierStatuses.filter((s: string) =>
    processingStatuses.includes(s)
  ).length;
  const errorDossierCount = dossierStatuses.filter((s: string) => s === "error").length;
  const completedEstimations = completedEstimationsRes.count ?? 0;

  const latestModel = latestModelRes.data as {
    id: string;
    version: number;
    accuracy_metrics: { mae?: number; r_squared?: number } | null;
    training_dossier_count: number | null;
    is_active: boolean;
    created_at: string;
  } | null;

  const activeQQPs = (activeQQPDefsRes.data ?? []) as {
    name: string;
    display_name: string;
    weight: number;
    weight_confidence: number;
    discovery_source: string;
  }[];
  const seededCount = activeQQPs.filter(
    (q) => q.discovery_source === "seeded" || q.discovery_source === "expert_added"
  ).length;
  const discoveredCount = activeQQPs.filter((q) => q.discovery_source === "ai_discovered").length;

  // ── Section 2 ───────────────────────────────────────────────────────────────
  const pricedCount = pricedCountRes.count ?? 0;
  const predErrors = (predErrorsRes.data ?? []).map((r: { prediction_error: number }) =>
    Math.abs(Number(r.prediction_error))
  );
  const avgPredError =
    predErrors.length > 0
      ? predErrors.reduce((a: number, b: number) => a + b, 0) / predErrors.length
      : null;

  const allModelVersions = (allModelVersionsRes.data ?? []) as {
    version: number;
    accuracy_metrics: { mae?: number; r_squared?: number } | null;
    training_dossier_count: number | null;
    created_at: string;
  }[];
  const modelVersionCount = allModelVersions.length;

  const settingsMap = Object.fromEntries(
    (settingsRes.data ?? []).map((s: { key: string; value: unknown }) => [s.key, s.value])
  );
  const discoveryThreshold = Number(settingsMap.qqp_discovery_threshold ?? 3);
  const calibrationInterval = Number(settingsMap.calibration_interval ?? 10);

  const learningCurveData: ModelVersionPoint[] = allModelVersions.map((v) => ({
    version: v.version,
    mae: (v.accuracy_metrics as { mae?: number } | null)?.mae ?? null,
    r_squared: (v.accuracy_metrics as { r_squared?: number } | null)?.r_squared ?? null,
    training_dossier_count: v.training_dossier_count,
    created_at: v.created_at,
  }));

  // ── Section 3 ───────────────────────────────────────────────────────────────
  const proposedMap = new Map<string, { name: string; count: number; desc: string | null }>();
  for (const row of (proposedQQPsRes.data ?? []) as {
    proposed_name: string;
    proposed_description: string | null;
    dossier_id: string | null;
  }[]) {
    if (!proposedMap.has(row.proposed_name)) {
      proposedMap.set(row.proposed_name, {
        name: row.proposed_name,
        count: 0,
        desc: row.proposed_description,
      });
    }
    proposedMap.get(row.proposed_name)!.count += 1;
  }
  const proposedQQPs = Array.from(proposedMap.values()).sort((a, b) => b.count - a.count);

  const topQQPs = [...activeQQPs]
    .sort((a, b) => Math.abs(Number(b.weight)) - Math.abs(Number(a.weight)))
    .slice(0, 10);
  const allWeightsZero = topQQPs.every((q) => Number(q.weight) === 0);

  // ── Section 4 ───────────────────────────────────────────────────────────────
  const apiCallsToday = (apiCallsTodayRes.data ?? []) as { call_type: string; status: string }[];
  const apiCallCount = apiCallsToday.length;
  const apiBreakdown = apiCallsToday.reduce(
    (acc: Record<string, number>, c) => {
      acc[c.call_type] = (acc[c.call_type] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const allTimes = [
    ...(estTimesRes.data ?? []).map((r: { processing_time_ms: number }) =>
      Number(r.processing_time_ms)
    ),
    ...(dosTimesRes.data ?? []).map((r: { processing_time_ms: number }) =>
      Number(r.processing_time_ms)
    ),
  ].filter((t) => t > 0);
  const avgProcessingMs =
    allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : null;

  const errors24h = (errors24hDosRes.count ?? 0) + (errors24hEstRes.count ?? 0);
  const fileCount = fileCountRes.count ?? 0;

  // ── Section 5 ───────────────────────────────────────────────────────────────
  const events: ActivityEvent[] = [];

  for (const d of (recentDossiersRes.data ?? []) as {
    id: string;
    plan_file_name: string | null;
    status: string;
    updated_at: string;
  }[]) {
    events.push({
      id: `d-${d.id}`,
      time: new Date(d.updated_at),
      eventType:
        d.status === "analyzed"
          ? "Dossier analyzed"
          : d.status === "error"
          ? "Dossier error"
          : d.status === "pending"
          ? "Dossier uploaded"
          : "Dossier processing",
      details: d.plan_file_name ?? "Plan file",
      badge: d.status === "analyzed" ? "ok" : d.status === "error" ? "error" : "pending",
    });
  }

  for (const e of (recentEstimationsRes.data ?? []) as {
    id: string;
    plan_file_name: string | null;
    status: string;
    updated_at: string;
  }[]) {
    events.push({
      id: `e-${e.id}`,
      time: new Date(e.updated_at),
      eventType:
        e.status === "complete"
          ? "Estimation complete"
          : e.status === "error"
          ? "Estimation error"
          : "Estimation processing",
      details: e.plan_file_name ?? "Building plan",
      badge: e.status === "complete" ? "ok" : e.status === "error" ? "error" : "pending",
    });
  }

  for (const d of (recentDiscoveryRes.data ?? []) as {
    id: string;
    proposed_name: string;
    status: string;
    created_at: string;
  }[]) {
    events.push({
      id: `disc-${d.id}`,
      time: new Date(d.created_at),
      eventType: d.status === "accepted" ? "QQP activated" : "QQP proposed",
      details: d.proposed_name,
      badge: d.status === "accepted" ? "ok" : "pending",
    });
  }

  for (const mv of (recentModelVersRes.data ?? []) as {
    id: string;
    version: number;
    created_at: string;
  }[]) {
    events.push({
      id: `mv-${mv.id}`,
      time: new Date(mv.created_at),
      eventType: "Model calibrated",
      details: `v${mv.version}`,
      badge: "ok",
    });
  }

  for (const e of (recentApiErrorsRes.data ?? []) as {
    id: string;
    call_type: string;
    error_message: string | null;
    created_at: string;
  }[]) {
    events.push({
      id: `api-${e.id}`,
      time: new Date(e.created_at),
      eventType: "API error",
      details: `${e.call_type}${e.error_message ? `: ${e.error_message.substring(0, 50)}` : ""}`,
      badge: "error",
    });
  }

  events.sort((a, b) => b.time.getTime() - a.time.getTime());

  return {
    // Section 1
    totalDossiers,
    analyzedCount,
    pendingCount,
    errorDossierCount,
    completedEstimations,
    latestModel,
    activeQQPCount: activeQQPs.length,
    seededCount,
    discoveredCount,
    // Section 2
    pricedCount,
    avgPredError,
    modelVersionCount,
    calibrationInterval,
    learningCurveData,
    // Section 3
    proposedQQPs,
    discoveryThreshold,
    topQQPs,
    allWeightsZero,
    // Section 4
    apiCallCount,
    apiBreakdown,
    avgProcessingMs,
    processingJobCount: allTimes.length,
    errors24h,
    fileCount,
    // Section 5
    events: events.slice(0, 20),
    // Controls
    hasPending: pendingCount > 0,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AnalyticsPage() {
  const d = await fetchData();

  // Progress values
  const pricedProgress = Math.min(1, d.pricedCount / 50);
  const errorProgress =
    d.avgPredError != null ? Math.max(0, 1 - d.avgPredError / 0.2) : 0;
  const calibNextAt =
    d.pricedCount > 0
      ? Math.ceil(d.pricedCount / d.calibrationInterval) * d.calibrationInterval
      : d.calibrationInterval;
  const calibProgress = d.calibrationInterval > 0
    ? (d.pricedCount % d.calibrationInterval) / d.calibrationInterval
    : 0;

  const latestMetrics = d.latestModel?.accuracy_metrics as
    | { mae?: number; r_squared?: number }
    | null
    | undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pipeline health, model progress, and recent activity.
          </p>
        </div>
        <AnalyticsControls hasPending={d.hasPending} />
      </div>

      {/* ── Section 1: Overview ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          title="Total dossiers"
          value={d.totalDossiers}
          subtitle={`${d.analyzedCount} analyzed · ${d.pendingCount} pending · ${d.errorDossierCount} error`}
        />
        <MetricCard
          title="Estimations done"
          value={d.completedEstimations}
          subtitle="Status: complete"
        />
        <MetricCard
          title="Model accuracy"
          value={
            latestMetrics?.mae != null
              ? `MAE ${latestMetrics.mae.toFixed(3)}`
              : latestMetrics?.r_squared != null
              ? `R² ${latestMetrics.r_squared.toFixed(3)}`
              : "—"
          }
          subtitle={
            d.latestModel
              ? `v${d.latestModel.version} · ${d.latestModel.training_dossier_count ?? "?"} dossiers`
              : "Need 10+ priced dossiers"
          }
          accent={
            latestMetrics?.mae != null
              ? latestMetrics.mae < 0.1
                ? "green"
                : latestMetrics.mae < 0.2
                ? "amber"
                : "red"
              : undefined
          }
        />
        <MetricCard
          title="Active QQPs"
          value={d.activeQQPCount}
          subtitle={`${d.seededCount} seeded · ${d.discoveredCount} discovered`}
        />
      </div>

      <Separator />

      {/* ── Section 2: Training progress ──────────────────────────────────── */}
      <div>
        <h2 className="mb-4 text-lg font-medium">Training progress</h2>
        <Card>
          <CardContent className="space-y-6 pt-6">
            {/* Bar 1: Dossiers with known price */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Dossiers with known price</span>
                <span className="tabular-nums text-muted-foreground">
                  {d.pricedCount} / 50
                </span>
              </div>
              <ProgressBar
                value={pricedProgress}
                color={d.pricedCount >= 50 ? "bg-green-500" : "bg-primary"}
              />
              <p className="text-xs text-muted-foreground">Target: 50 for reliable weights</p>
            </div>

            {/* Bar 2: Avg prediction error */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Avg prediction error</span>
                <span className="tabular-nums text-muted-foreground">
                  {d.avgPredError != null
                    ? `${(d.avgPredError * 100).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
              <ProgressBar
                value={errorProgress}
                color={
                  d.avgPredError == null
                    ? "bg-muted"
                    : d.avgPredError < 0.1
                    ? "bg-green-500"
                    : d.avgPredError < 0.15
                    ? "bg-amber-500"
                    : "bg-red-500"
                }
              />
              <p className="text-xs text-muted-foreground">
                Target: &lt;10% · bar fills as error decreases
              </p>
            </div>

            {/* Bar 3: Weight calibrations */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Weight calibrations</span>
                <span className="tabular-nums text-muted-foreground">
                  {d.modelVersionCount} run{d.modelVersionCount !== 1 ? "s" : ""}
                </span>
              </div>
              <ProgressBar value={calibProgress} color="bg-violet-500" />
              <p className="text-xs text-muted-foreground">
                Next at {calibNextAt} priced dossiers (interval: {d.calibrationInterval})
              </p>
            </div>

            {/* Learning curve */}
            {d.learningCurveData.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">Model accuracy over time</p>
                  <LearningCurveChart data={d.learningCurveData} />
                  <p className="text-xs text-muted-foreground">
                    MAE (red, lower = better) · R² (green, higher = better)
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* ── Section 3: QQP Discovery ───────────────────────────────────────── */}
      <div>
        <h2 className="mb-4 text-lg font-medium">QQP discovery</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: Proposed QQPs */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Proposed QQPs
                {d.proposedQQPs.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {d.proposedQQPs.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d.proposedQQPs.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No pending proposals. Process more dossiers to generate suggestions.
                </p>
              ) : (
                <div className="space-y-3">
                  {d.proposedQQPs.slice(0, 8).map((p) => {
                    const progress = Math.min(1, p.count / d.discoveryThreshold);
                    const atThreshold = p.count >= d.discoveryThreshold;
                    const almostThere = p.count === d.discoveryThreshold - 1;
                    return (
                      <div key={p.name} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-medium">{p.name}</span>
                          <span
                            className={`text-xs tabular-nums font-medium ${
                              atThreshold
                                ? "text-green-600"
                                : almostThere
                                ? "text-amber-600"
                                : "text-muted-foreground"
                            }`}
                          >
                            {p.count}/{d.discoveryThreshold}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              atThreshold
                                ? "bg-green-500"
                                : almostThere
                                ? "bg-amber-500"
                                : "bg-primary"
                            }`}
                            style={{ width: `${progress * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {d.proposedQQPs.length > 8 && (
                    <p className="text-xs text-muted-foreground">
                      +{d.proposedQQPs.length - 8} more — see QQP Model page
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Top weighted QQPs */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Top weighted QQPs</CardTitle>
            </CardHeader>
            <CardContent>
              {d.topQQPs.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No active QQPs.</p>
              ) : d.allWeightsZero ? (
                <p className="py-4 text-sm text-muted-foreground">
                  Weights populate after first calibration.
                </p>
              ) : (
                <div className="space-y-2">
                  {d.topQQPs.map((q) => (
                    <div key={q.name} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{q.display_name}</p>
                      </div>
                      <WeightBar
                        weight={Number(q.weight ?? 0)}
                        confidence={Number(q.weight_confidence ?? 0)}
                      />
                      <Badge
                        variant="outline"
                        className="shrink-0 text-[10px] px-1.5 py-0"
                      >
                        {q.discovery_source === "ai_discovered" ? "AI" : "seed"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* ── Section 4: System health ───────────────────────────────────────── */}
      <div>
        <h2 className="mb-4 text-lg font-medium">System health</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            title="API calls today"
            value={d.apiCallCount}
            subtitle={
              Object.entries(d.apiBreakdown)
                .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
                .join(" · ") || "No calls yet"
            }
          />
          <MetricCard
            title="Avg processing time"
            value={
              d.avgProcessingMs != null
                ? `${(d.avgProcessingMs / 1000).toFixed(1)}s`
                : "—"
            }
            subtitle={`Over ${d.processingJobCount} jobs`}
          />
          <MetricCard
            title="Errors (24 h)"
            value={d.errors24h}
            subtitle="Dossiers + estimations"
            accent={d.errors24h > 0 ? "red" : undefined}
          />
          <MetricCard
            title="Files in storage"
            value={d.fileCount}
            subtitle="Plans bucket"
          />
        </div>
      </div>

      <Separator />

      {/* ── Section 5: Recent activity ─────────────────────────────────────── */}
      <div>
        <h2 className="mb-4 text-lg font-medium">Recent activity</h2>
        {d.events.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No activity yet. Upload dossiers or run an estimation to see events here.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Time</TableHead>
                  <TableHead className="w-[180px]">Event</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-[80px] text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {timeAgo(ev.time)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{ev.eventType}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {ev.details}
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusBadge status={ev.badge} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
