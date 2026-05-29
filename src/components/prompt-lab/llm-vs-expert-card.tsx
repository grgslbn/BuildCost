"use client";

import { cn } from "@/lib/utils";
import {
  computeError, getStatus, statusLabel, statusColor,
  fmtSqm, fmtEur, fmtPct, fmtF,
  type StatusLevel,
} from "@/lib/prompt-lab/compare";
import { StatusIcon } from "@/components/prompt-lab/status-icon";
import { ExtractionDetails, type SqmExtraction } from "@/components/prompt-lab/extraction-details";

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

type Row = {
  label: string;
  llm: string;
  expert: string;
  delta: string;
  status: StatusLevel;
  errorPct: number | null;
};

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
