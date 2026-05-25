"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Square, CheckCircle2, AlertCircle, Loader2, Search, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { EstimationOption, DossierOption } from "./page";

// ── Status helpers ────────────────────────────────────────────────────────────

const STEPS = ["uploading", "extracting_sqm", "analyzing_qqp", "calculating", "complete"];
const TERMINAL = new Set(["complete", "error"]);

function fmtEur(v: string | number | null | undefined) {
  if (v == null) return null;
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v));
}
function fmtMs(ms: number | null | undefined) {
  if (ms == null) return null;
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)} min`;
}
function shortId(id: string) { return id.slice(0, 8) + "…"; }
function shortFile(name: string | null) {
  if (!name) return "—";
  return name.length > 40 ? name.slice(0, 38) + "…" : name;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    uploading: "bg-blue-100 text-blue-700",
    extracting_sqm: "bg-violet-100 text-violet-700",
    analyzing_qqp: "bg-amber-100 text-amber-700",
    calculating: "bg-orange-100 text-orange-700",
    pending: "bg-muted text-muted-foreground",
    analyzed: "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function StepTracker({ status }: { status: string }) {
  const currentIdx = STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STEPS.map((step, i) => {
        const done   = currentIdx > i || status === "complete";
        const active = currentIdx === i && !TERMINAL.has(status);
        return (
          <div key={step} className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono ${
              done    ? "bg-green-100 text-green-700" :
              active  ? "bg-violet-100 text-violet-700 animate-pulse" :
              "bg-muted text-muted-foreground/50"
            }`}>
              {active && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {step.replace(/_/g, " ")}
            </span>
            {i < STEPS.length - 1 && <span className="text-muted-foreground/30 text-xs">›</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Estimation runner card ────────────────────────────────────────────────────

function EstimationCard({ estimations }: { estimations: EstimationOption[] }) {
  const [selectedId, setSelectedId] = useState(estimations[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function poll(id: string) {
    try {
      const res = await fetch(`/api/admin/pipeline-test?type=estimation&id=${id}`);
      const data = await res.json();
      setStatusData(data);
      if (TERMINAL.has(data.status as string)) {
        stopPoll();
        setRunning(false);
      }
    } catch { /* silent */ }
  }

  async function run() {
    if (!selectedId) return;
    setError(null);
    setStatusData(null);
    setRunning(true);

    // 1. Reset the row
    const resetRes = await fetch("/api/admin/pipeline-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_estimation", estimationId: selectedId }),
    });
    if (!resetRes.ok) {
      const d = await resetRes.json();
      setError(d.error ?? "Reset failed");
      setRunning(false);
      return;
    }

    // 2. Fire pipeline fire-and-forget
    fetch("/api/estimate-process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimationId: selectedId }),
    }).catch(() => {});

    // 3. Poll every 2s
    stopPoll();
    await poll(selectedId);
    pollRef.current = setInterval(() => poll(selectedId), 2000);
  }

  function stop() {
    stopPoll();
    setRunning(false);
  }

  useEffect(() => () => stopPoll(), []);

  const selected = estimations.find((e) => e.id === selectedId);
  const st = statusData as { status?: string; error_message?: string; estimated_total_cost?: string; processing_time_ms?: number; total_gross_sqm?: number; finishing_level?: string; overall_confidence?: number; progress_detail?: string } | null;

  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">1</span>
          Re-run estimation pipeline
        </CardTitle>
        <CardDescription className="text-xs">
          Resets the row and re-fires the full pipeline (SQM → QQP → cost). Uses existing stored PDF — no re-upload needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="est-select" className="text-xs">Select estimation</Label>
          <select
            id="est-select"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setStatusData(null); setError(null); }}
            disabled={running}
          >
            {estimations.map((e) => (
              <option key={e.id} value={e.id}>
                {shortId(e.id)} · {shortFile(e.plan_file_name)} · {e.status}
                {e.estimated_total_cost ? ` · ${fmtEur(e.estimated_total_cost)}` : ""}
              </option>
            ))}
          </select>
          {selected && (
            <p className="text-xs text-muted-foreground font-mono">{selected.id}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={run} disabled={running || !selectedId}>
            {running ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Running…</> : <><Play className="mr-1.5 h-3.5 w-3.5" />Re-run pipeline</>}
          </Button>
          {running && (
            <Button size="sm" variant="outline" onClick={stop}>
              <Square className="mr-1.5 h-3.5 w-3.5" />Stop polling
            </Button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {st && (
          <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <StatusBadge status={st.status ?? "unknown"} />
              {st.processing_time_ms != null && (
                <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1">
                  <Clock className="h-3 w-3" />{fmtMs(st.processing_time_ms)}
                </span>
              )}
            </div>

            <StepTracker status={st.status ?? ""} />

            {st.progress_detail && (
              <p className="text-xs text-muted-foreground italic">{st.progress_detail as string}</p>
            )}

            {st.status === "complete" && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-green-50 p-2">
                  <div className="text-green-600 font-medium">Total cost</div>
                  <div className="text-green-800 font-semibold text-base">{fmtEur(st.estimated_total_cost) ?? "—"}</div>
                </div>
                <div className="rounded bg-background border p-2">
                  <div className="text-muted-foreground font-medium">Gross area</div>
                  <div className="font-semibold">{st.total_gross_sqm != null ? `${Number(st.total_gross_sqm).toFixed(1)} m²` : "—"}</div>
                </div>
                <div className="rounded bg-background border p-2">
                  <div className="text-muted-foreground font-medium">Finishing</div>
                  <div className="font-semibold capitalize">{st.finishing_level ?? "—"}</div>
                </div>
                <div className="rounded bg-background border p-2">
                  <div className="text-muted-foreground font-medium">Confidence</div>
                  <div className="font-semibold">{st.overall_confidence != null ? `${(Number(st.overall_confidence) * 100).toFixed(0)}%` : "—"}</div>
                </div>
              </div>
            )}

            {st.status === "error" && (
              <div className="flex items-start gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {st.error_message ?? "Unknown error"}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Dossier runner card ───────────────────────────────────────────────────────

function DossierCard({ dossiers }: { dossiers: DossierOption[] }) {
  const [selectedId, setSelectedId] = useState(dossiers[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const DOSSIER_TERMINAL = new Set(["analyzed", "error"]);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function poll(id: string) {
    try {
      const res = await fetch(`/api/admin/pipeline-test?type=dossier&id=${id}`);
      const data = await res.json();
      setStatusData(data);
      if (DOSSIER_TERMINAL.has(data.status as string)) {
        stopPoll();
        setRunning(false);
      }
    } catch { /* silent */ }
  }

  async function run() {
    if (!selectedId) return;
    setError(null);
    setStatusData(null);
    setRunning(true);

    const resetRes = await fetch("/api/admin/pipeline-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_dossier", dossierId: selectedId }),
    });
    if (!resetRes.ok) {
      const d = await resetRes.json();
      setError(d.error ?? "Reset failed");
      setRunning(false);
      return;
    }

    fetch("/api/process-dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dossierId: selectedId }),
    }).catch(() => {});

    stopPoll();
    await poll(selectedId);
    pollRef.current = setInterval(() => poll(selectedId), 2000);
  }

  function stop() { stopPoll(); setRunning(false); }

  useEffect(() => () => stopPoll(), []);

  const selected = dossiers.find((d) => d.id === selectedId);
  const st = statusData as { status?: string; error_message?: string; predicted_finishing_coefficient?: number; prediction_error?: number; processing_time_ms?: number } | null;

  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">2</span>
          Re-process reference dossier
        </CardTitle>
        <CardDescription className="text-xs">
          Resets and re-runs SQM + QQP extraction on a reference dossier. Used for benchmarking and weight calibration.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dossier-select" className="text-xs">Select dossier</Label>
          <select
            id="dossier-select"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setStatusData(null); setError(null); }}
            disabled={running}
          >
            {dossiers.map((d) => (
              <option key={d.id} value={d.id}>
                {shortId(d.id)} · {shortFile(d.plan_file_name)} · {d.status}
                {d.postcode ? ` · ${d.postcode}` : ""}
              </option>
            ))}
          </select>
          {selected && (
            <p className="text-xs text-muted-foreground font-mono">{selected.id}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={run} disabled={running || !selectedId}>
            {running ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Running…</> : <><Play className="mr-1.5 h-3.5 w-3.5" />Re-process</>}
          </Button>
          {running && (
            <Button size="sm" variant="outline" onClick={stop}>
              <Square className="mr-1.5 h-3.5 w-3.5" />Stop polling
            </Button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
          </div>
        )}

        {st && (
          <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <StatusBadge status={st.status ?? "unknown"} />
              {st.processing_time_ms != null && (
                <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1">
                  <Clock className="h-3 w-3" />{fmtMs(st.processing_time_ms)}
                </span>
              )}
            </div>

            {st.status === "analyzed" && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-green-50 p-2">
                  <div className="text-green-600 font-medium">Finishing coeff. (F)</div>
                  <div className="text-green-800 font-semibold text-base">
                    {st.predicted_finishing_coefficient != null ? Number(st.predicted_finishing_coefficient).toFixed(3) : "—"}
                  </div>
                </div>
                <div className="rounded bg-background border p-2">
                  <div className="text-muted-foreground font-medium">Prediction error</div>
                  <div className="font-semibold">
                    {st.prediction_error != null ? `${(Number(st.prediction_error) * 100).toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>
            )}

            {st.status === "error" && (
              <div className="flex items-start gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {st.error_message ?? "Unknown error"}
              </div>
            )}

            {!DOSSIER_TERMINAL.has(st.status ?? "") && (
              <div className="flex items-center gap-1.5 text-xs text-violet-700 animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                {(st.status as string)?.replace(/_/g, " ") ?? "processing…"}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Status probe card ─────────────────────────────────────────────────────────

function StatusProbeCard() {
  const [probeId, setProbeId] = useState("");
  const [probeType, setProbeType] = useState<"estimation" | "dossier">("estimation");
  const [probeData, setProbeData] = useState<Record<string, unknown> | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);

  async function probe() {
    if (!probeId.trim()) return;
    setProbeLoading(true);
    setProbeData(null);
    setProbeError(null);
    try {
      const res = await fetch(`/api/admin/pipeline-test?type=${probeType}&id=${probeId.trim()}`);
      const data = await res.json();
      if (!res.ok) { setProbeError(data.error ?? "Not found"); }
      else { setProbeData(data); }
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : "network error");
    } finally {
      setProbeLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">3</span>
          Status probe
        </CardTitle>
        <CardDescription className="text-xs">
          Paste any estimation or dossier ID to inspect its current DB state.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={probeType === "estimation" ? "default" : "outline"}
            onClick={() => setProbeType("estimation")}
          >
            Estimation
          </Button>
          <Button
            size="sm"
            variant={probeType === "dossier" ? "default" : "outline"}
            onClick={() => setProbeType("dossier")}
          >
            Dossier
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="UUID…"
            value={probeId}
            onChange={(e) => setProbeId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && probe()}
            className="font-mono text-sm"
          />
          <Button size="sm" onClick={probe} disabled={probeLoading || !probeId.trim()}>
            {probeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {probeError && (
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />{probeError}
          </div>
        )}

        {probeData && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={(probeData.status as string) ?? "unknown"} />
              {probeData.processing_time_ms != null && (
                <span className="text-xs text-muted-foreground">{fmtMs(probeData.processing_time_ms as number)}</span>
              )}
            </div>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-64 leading-relaxed">
              {JSON.stringify(probeData, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function PipelineTestClient({
  estimations,
  dossiers,
}: {
  estimations: EstimationOption[];
  dossiers: DossierOption[];
}) {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-3xl space-y-8">

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline test panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Re-run the estimation or dossier pipeline on any existing row. The pipeline fires against the already-stored PDF — no re-upload needed. Status updates live every 2s.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              {estimations.filter((e) => e.status === "complete").length} complete estimations
            </Badge>
            <Badge variant="outline" className="text-xs gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              {dossiers.filter((d) => d.status === "analyzed").length} analyzed dossiers
            </Badge>
            {estimations.filter((e) => e.status === "error").length > 0 && (
              <Badge variant="outline" className="text-xs gap-1">
                <AlertCircle className="h-3 w-3 text-red-500" />
                {estimations.filter((e) => e.status === "error").length} errored estimations
              </Badge>
            )}
          </div>
        </div>

        <EstimationCard estimations={estimations} />
        <DossierCard dossiers={dossiers} />
        <StatusProbeCard />

      </div>
    </div>
  );
}
