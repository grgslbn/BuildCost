"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, Minus, ChevronDown, ChevronRight, Building2, AlertCircle } from "lucide-react";

type ComparisonData = {
  // LLM extraction (latest result)
  llm_cat1_sqm: number | null;
  llm_cat2_sqm: number | null;
  llm_cat3_sqm: number | null;
  llm_total_cost: number | null;
  llm_finishing_coefficient: number | null;
  llm_confidence: number | null;
  // Expert ground truth
  expert_cat1_sqm: number | null;
  expert_cat2_sqm: number | null;
  expert_cat3_sqm: number | null;
  expert_total_price: number | null;
  expert_finishing_level: string | null;
};

type SqmExtraction = {
  project?: {
    scale?: string;
    postcode?: string;
    architect?: string;
    description?: string;
    scale_confidence?: number;
  };
  buildings?: Array<{
    id: string;
    name: string;
    type?: string;
    unit_count?: number;
    floors?: Array<{
      label: string;
      level: number;
      cat1_sqm: number;
      cat2_sqm: number;
      cat3_sqm: number;
      contents?: string;
      measurement?: string;
    }>;
    building_totals?: {
      cat1_sqm: number;
      cat2_sqm: number;
      cat3_sqm: number;
    };
  }>;
  extraction_warnings?: string[];
};

function computeError(llm: number | null, expert: number | null): number | null {
  if (llm == null || expert == null || expert === 0) return null;
  return ((llm - expert) / expert) * 100;
}

type StatusLevel = "match" | "close" | "warning" | "error" | "na";

function getStatus(errorPct: number | null): StatusLevel {
  if (errorPct == null) return "na";
  const abs = Math.abs(errorPct);
  if (abs <= 5) return "match";
  if (abs <= 15) return "close";
  if (abs <= 30) return "warning";
  return "error";
}

function StatusIcon({ status }: { status: StatusLevel }) {
  switch (status) {
    case "match":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "close":
      return <CheckCircle2 className="h-4 w-4 text-amber-500" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "na":
      return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusLabel(status: StatusLevel): string {
  switch (status) {
    case "match": return "Exact (≤5%)";
    case "close": return "Dichtbij (≤15%)";
    case "warning": return "Afwijking (≤30%)";
    case "error": return "Groot verschil";
    case "na": return "Geen data";
  }
}

function fmtSqm(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} m²`;
}

function fmtEur(n: number | null): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtF(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

type Row = {
  label: string;
  llm: string;
  expert: string;
  delta: string;
  status: StatusLevel;
  errorPct: number | null;
};

function statusColor(status: StatusLevel): string {
  switch (status) {
    case "match": return "text-green-600";
    case "close": return "text-amber-600";
    case "warning": return "text-orange-600";
    case "error": return "text-red-600 font-medium";
    case "na": return "text-muted-foreground";
  }
}

export function LlmVsExpertCard({ data, sqmExtraction }: { data: ComparisonData; sqmExtraction?: SqmExtraction | null }) {
  const cat1Err = computeError(data.llm_cat1_sqm, data.expert_cat1_sqm);
  const cat2Err = computeError(data.llm_cat2_sqm, data.expert_cat2_sqm);
  const cat3Err = computeError(data.llm_cat3_sqm, data.expert_cat3_sqm);
  const costErr = computeError(data.llm_total_cost, data.expert_total_price);

  // Compute total SQM
  const llmTotal = (data.llm_cat1_sqm ?? 0) + (data.llm_cat2_sqm ?? 0) + (data.llm_cat3_sqm ?? 0);
  const expertTotal = (data.expert_cat1_sqm ?? 0) + (data.expert_cat2_sqm ?? 0) + (data.expert_cat3_sqm ?? 0);
  const totalErr = expertTotal > 0 ? computeError(llmTotal, expertTotal) : null;

  const rows: Row[] = [
    {
      label: "Cat1 — Bewoonbaar",
      llm: fmtSqm(data.llm_cat1_sqm),
      expert: fmtSqm(data.expert_cat1_sqm),
      delta: fmtPct(cat1Err),
      status: getStatus(cat1Err),
      errorPct: cat1Err,
    },
    {
      label: "Cat2 — Gesloten bijgebouw",
      llm: fmtSqm(data.llm_cat2_sqm),
      expert: fmtSqm(data.expert_cat2_sqm),
      delta: fmtPct(cat2Err),
      status: getStatus(cat2Err),
      errorPct: cat2Err,
    },
    {
      label: "Cat3 — Overdekt buiten",
      llm: fmtSqm(data.llm_cat3_sqm),
      expert: fmtSqm(data.expert_cat3_sqm),
      delta: fmtPct(cat3Err),
      status: getStatus(cat3Err),
      errorPct: cat3Err,
    },
    {
      label: "Totaal oppervlakte",
      llm: fmtSqm(llmTotal || null),
      expert: fmtSqm(expertTotal || null),
      delta: fmtPct(totalErr),
      status: getStatus(totalErr),
      errorPct: totalErr,
    },
    {
      label: "Herbouwkost",
      llm: fmtEur(data.llm_total_cost),
      expert: fmtEur(data.expert_total_price),
      delta: fmtPct(costErr),
      status: getStatus(costErr),
      errorPct: costErr,
    },
    {
      label: "Afwerkingsniveau (F)",
      llm: fmtF(data.llm_finishing_coefficient),
      expert: data.expert_finishing_level ?? "—",
      delta: "—",
      status: "na",
      errorPct: null,
    },
  ];

  // Overall accuracy
  const validErrors = [cat1Err, cat2Err, cat3Err, costErr].filter((e): e is number => e != null);
  const overallAccuracy = validErrors.length > 0
    ? Math.max(0, 100 - validErrors.reduce((a, b) => a + Math.abs(b), 0) / validErrors.length)
    : null;

  const matchCount = rows.filter((r) => r.status === "match").length;
  const errorCount = rows.filter((r) => r.status === "error" || r.status === "warning").length;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-sm">
        {overallAccuracy != null && (
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-24 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  overallAccuracy >= 90 ? "bg-green-500" :
                  overallAccuracy >= 75 ? "bg-amber-500" :
                  overallAccuracy >= 60 ? "bg-orange-500" : "bg-red-500"
                )}
                style={{ width: `${overallAccuracy}%` }}
              />
            </div>
            <span className="font-medium tabular-nums">{Math.round(overallAccuracy)}%</span>
          </div>
        )}
        <span className="text-muted-foreground">
          {matchCount > 0 && <span className="text-green-600">{matchCount} exact</span>}
          {matchCount > 0 && errorCount > 0 && " · "}
          {errorCount > 0 && <span className="text-red-600">{errorCount} afwijkend</span>}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-8 px-3 py-2.5"></th>
              <th className="px-4 py-2.5 text-left font-medium">Metric</th>
              <th className="px-4 py-2.5 text-right font-medium">LLM</th>
              <th className="px-4 py-2.5 text-right font-medium">Expert (CED)</th>
              <th className="px-4 py-2.5 text-right font-medium w-[80px]">Delta</th>
              <th className="px-4 py-2.5 text-left font-medium w-[120px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className={cn(
                  "border-b last:border-0 transition-colors",
                  row.label === "Herbouwkost" && "bg-muted/20 font-medium",
                  row.label === "Totaal oppervlakte" && "bg-muted/10 border-t-2",
                )}
              >
                <td className="px-3 py-2.5 text-center">
                  <StatusIcon status={row.status} />
                </td>
                <td className="px-4 py-2.5">{row.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{row.llm}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{row.expert}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums", statusColor(row.status))}>
                  {row.delta}
                </td>
                <td className={cn("px-4 py-2.5 text-xs", statusColor(row.status))}>
                  {statusLabel(row.status)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confidence note */}
      {data.llm_confidence != null && (
        <p className="text-xs text-muted-foreground">
          LLM confidence: {(data.llm_confidence * 100).toFixed(0)}%
        </p>
      )}

      {/* Extraction details — collapsible */}
      {sqmExtraction && <ExtractionDetails extraction={sqmExtraction} />}
    </div>
  );
}

/* ---------- Extraction detail sub-component ---------- */

function ExtractionDetails({ extraction }: { extraction: SqmExtraction }) {
  const [open, setOpen] = useState(false);
  const buildings = extraction.buildings ?? [];
  const warnings = extraction.extraction_warnings ?? [];
  const project = extraction.project;

  if (buildings.length === 0 && warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Extractie details ({buildings.length} gebouw{buildings.length !== 1 ? "en" : ""}{warnings.length > 0 ? `, ${warnings.length} waarschuwing${warnings.length !== 1 ? "en" : ""}` : ""})
      </button>

      {open && (
        <div className="space-y-3 pl-1">
          {/* Project info */}
          {project && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              {project.description && <p className="font-medium text-sm">{project.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {project.scale && <span>Schaal: {project.scale}</span>}
                {project.postcode && <span>Postcode: {project.postcode}</span>}
                {project.architect && <span>Architect: {project.architect}</span>}
                {project.scale_confidence != null && (
                  <span className={cn(
                    project.scale_confidence >= 0.7 ? "text-green-600" :
                    project.scale_confidence >= 0.5 ? "text-amber-600" : "text-red-600"
                  )}>
                    Schaal confidence: {(project.scale_confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Building breakdown */}
          {buildings.map((b) => (
            <div key={b.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{b.name || b.id}</span>
                {b.type && <span className="text-xs text-muted-foreground">({b.type})</span>}
              </div>

              {/* Per-floor table */}
              {b.floors && b.floors.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 text-left font-medium">Verdieping</th>
                      <th className="py-1 text-right font-medium">Cat1</th>
                      <th className="py-1 text-right font-medium">Cat2</th>
                      <th className="py-1 text-right font-medium">Cat3</th>
                      <th className="py-1 text-left pl-3 font-medium">Inhoud</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.floors.map((f, fi) => (
                      <tr key={fi} className="border-b last:border-0">
                        <td className="py-1.5">{f.label}</td>
                        <td className="py-1.5 text-right tabular-nums">{f.cat1_sqm > 0 ? `${f.cat1_sqm.toFixed(0)} m²` : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{f.cat2_sqm > 0 ? `${f.cat2_sqm.toFixed(0)} m²` : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{f.cat3_sqm > 0 ? `${f.cat3_sqm.toFixed(0)} m²` : "—"}</td>
                        <td className="py-1.5 pl-3 text-muted-foreground max-w-xs truncate">{f.contents || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Building measurement method */}
              {b.floors?.some((f) => f.measurement) && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {b.floors?.filter((f) => f.measurement).map((f, fi) => (
                    <p key={fi} className="font-mono">{f.measurement}</p>
                  ))}
                </div>
              )}

              {/* Building totals */}
              {b.building_totals && (
                <div className="flex gap-3 text-xs font-medium border-t pt-1.5">
                  <span>Totaal: Cat1 {b.building_totals.cat1_sqm} m²</span>
                  {b.building_totals.cat2_sqm > 0 && <span>Cat2 {b.building_totals.cat2_sqm} m²</span>}
                  {b.building_totals.cat3_sqm > 0 && <span>Cat3 {b.building_totals.cat3_sqm} m²</span>}
                </div>
              )}
            </div>
          ))}

          {/* Extraction warnings */}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                Extractie waarschuwingen
              </div>
              <ul className="text-xs text-amber-700/80 dark:text-amber-400/80 space-y-0.5 list-disc pl-4">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
