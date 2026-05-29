"use client";

import { cn } from "@/lib/utils";
import { FileText, Ruler, SlidersHorizontal, Euro, Receipt } from "lucide-react";
import {
  computeError, getStatus, statusLabel, statusColor,
  fmtSqm, fmtEur, fmtPct, fmtF,
  categoryUnitPrices, expertEffectivePerLivableSqm,
  type StatusLevel,
} from "@/lib/prompt-lab/compare";
import { StatusIcon } from "@/components/prompt-lab/status-icon";
import { ExtractionDetails, type SqmExtraction } from "@/components/prompt-lab/extraction-details";
import type { PricingConfig } from "@/lib/cost/calculate-cost";

type QqpScore = { score: number; confidence?: number; reasoning?: string };

type QqpGroup = {
  categoryName: string;
  displayName: string;
  items: { name: string; displayName: string; weight: number | null }[];
};

type Gt = {
  expert_cat1_sqm: number | null;
  expert_cat2_sqm: number | null;
  expert_cat3_sqm: number | null;
  expert_total_price: number | null;
  expert_finishing_level: string | null;
};

export type WalkthroughData = {
  planFileName: string | null;
  buildingCount: number | null;
  llm_cat1_sqm: number | null;
  llm_cat2_sqm: number | null;
  llm_cat3_sqm: number | null;
  predicted_f: number | null;
  expert_f: number | null;
  predicted_total_cost: number | null;
  sqmExtraction: SqmExtraction | null;
  qqpScores: Record<string, QqpScore> | null;
  qqpGroups: QqpGroup[];
  pricing: PricingConfig;
  gt: Gt | null;
};

/** Absolute-delta status for the finishing coefficient F (different scale than %). */
function getFStatus(deltaF: number | null): StatusLevel {
  if (deltaF == null) return "na";
  const abs = Math.abs(deltaF);
  if (abs <= 0.05) return "match";
  if (abs <= 0.15) return "close";
  if (abs <= 0.30) return "warning";
  return "error";
}

function StepHeader({
  n, icon: Icon, title, subtitle,
}: {
  n: number;
  icon: React.ElementType;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {n}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold tracking-tight">{title}</h3>
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

/** A LLM-vs-expert comparison row inside a step. */
function CompareRow({
  label, llm, expert, delta, status, highlight,
}: {
  label: string;
  llm: string;
  expert: string;
  delta: string;
  status: StatusLevel;
  highlight?: boolean;
}) {
  return (
    <tr className={cn("border-b last:border-0", highlight && "bg-primary/5 font-medium")}>
      <td className="px-3 py-2 text-center"><StatusIcon status={status} /></td>
      <td className="px-3 py-2">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{llm}</td>
      <td className="px-3 py-2 text-right tabular-nums">{expert}</td>
      <td className={cn("px-3 py-2 text-right tabular-nums", statusColor(status))}>{delta}</td>
      <td className={cn("px-3 py-2 text-xs", statusColor(status))}>{statusLabel(status)}</td>
    </tr>
  );
}

function CompareTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
            <th className="w-8 px-3 py-2"></th>
            <th className="px-3 py-2 text-left font-medium">Metric</th>
            <th className="px-3 py-2 text-right font-medium">LLM</th>
            <th className="px-3 py-2 text-right font-medium">Expert (CED)</th>
            <th className="px-3 py-2 text-right font-medium w-[80px]">Delta</th>
            <th className="px-3 py-2 text-left font-medium w-[120px]">Status</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** -1..+1 score bar centered at 0. */
function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(-1, Math.min(1, score));
  const pct = (Math.abs(clamped) / 1) * 50; // half-width
  const positive = clamped >= 0;
  return (
    <div className="relative h-2 w-full rounded-full bg-muted">
      {/* center line */}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
      <div
        className={cn(
          "absolute top-0 h-full rounded-full",
          positive ? "bg-green-500" : "bg-orange-500",
        )}
        style={positive ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
      />
    </div>
  );
}

export function PipelineWalkthrough({ data }: { data: WalkthroughData }) {
  const { gt, pricing } = data;

  // ── Step 2: SQM totals comparison ────────────────────────────────
  const cat1Err = computeError(data.llm_cat1_sqm, gt?.expert_cat1_sqm);
  const cat2Err = computeError(data.llm_cat2_sqm, gt?.expert_cat2_sqm);
  const cat3Err = computeError(data.llm_cat3_sqm, gt?.expert_cat3_sqm);

  // ── Step 3: F comparison ─────────────────────────────────────────
  const fDelta = data.predicted_f != null && data.expert_f != null
    ? data.predicted_f - data.expert_f
    : null;

  // ── Step 4: unit prices per category ─────────────────────────────
  const llmPrices = categoryUnitPrices(data.predicted_f, pricing);
  const expertPrices = categoryUnitPrices(data.expert_f, pricing);
  const cat1PriceErr = computeError(llmPrices?.cat1, expertPrices?.cat1);
  const cat2PriceErr = computeError(llmPrices?.cat2, expertPrices?.cat2);
  const cat3PriceErr = computeError(llmPrices?.cat3, expertPrices?.cat3);
  const expertEffectivePerLivable = expertEffectivePerLivableSqm(
    gt?.expert_total_price, gt?.expert_cat1_sqm,
  );

  // LLM category costs + subtotal + derived external factor (regio × ABEX)
  const llmSubtotal = llmPrices
    ? (data.llm_cat1_sqm ?? 0) * llmPrices.cat1
      + (data.llm_cat2_sqm ?? 0) * llmPrices.cat2
      + (data.llm_cat3_sqm ?? 0) * llmPrices.cat3
    : null;
  const externalFactor = data.predicted_total_cost && llmSubtotal
    ? data.predicted_total_cost / llmSubtotal
    : null;

  // ── Step 5: total cost ───────────────────────────────────────────
  const costErr = computeError(data.predicted_total_cost, gt?.expert_total_price);

  const hasQqp = data.qqpScores && Object.keys(data.qqpScores).length > 0;

  return (
    <div className="space-y-4">
      {/* Step 1 — Plan → lenzen */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <StepHeader
          n={1}
          icon={FileText}
          title="Plan → 2 lenzen"
          subtitle="Eén plan wordt naar twee LLM-lenzen gestuurd: SQM (oppervlaktes) en QQP (afwerkingsparameters)."
        />
        <div className="flex flex-wrap gap-x-6 gap-y-1 pl-10 text-sm">
          <span className="text-muted-foreground">Plan: <span className="font-medium text-foreground">{data.planFileName ?? "—"}</span></span>
          {data.buildingCount != null && (
            <span className="text-muted-foreground">Gebouwen gedetecteerd: <span className="font-medium text-foreground">{data.buildingCount}</span></span>
          )}
        </div>
      </div>

      {/* Step 2 — SQM lens */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <StepHeader
          n={2}
          icon={Ruler}
          title="SQM-lens — oppervlaktes per categorie"
          subtitle="Claude Vision leest het plan en meet m² per verdiep, gegroepeerd in Cat1 (bewoonbaar), Cat2 (gesloten bijgebouw), Cat3 (overdekt buiten)."
        />
        <CompareTable>
          <CompareRow label="Cat1 — Bewoonbaar" llm={fmtSqm(data.llm_cat1_sqm)} expert={fmtSqm(gt?.expert_cat1_sqm)} delta={fmtPct(cat1Err)} status={getStatus(cat1Err)} highlight />
          <CompareRow label="Cat2 — Gesloten bijgebouw" llm={fmtSqm(data.llm_cat2_sqm)} expert={fmtSqm(gt?.expert_cat2_sqm)} delta={fmtPct(cat2Err)} status={getStatus(cat2Err)} />
          <CompareRow label="Cat3 — Overdekt buiten" llm={fmtSqm(data.llm_cat3_sqm)} expert={fmtSqm(gt?.expert_cat3_sqm)} delta={fmtPct(cat3Err)} status={getStatus(cat3Err)} />
        </CompareTable>
        {data.sqmExtraction && <ExtractionDetails extraction={data.sqmExtraction} defaultOpen />}
      </div>

      {/* Step 3 — QQP lens */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <StepHeader
          n={3}
          icon={SlidersHorizontal}
          title="QQP-lens — afwerkingsparameters → F"
          subtitle="Claude scoort kwaliteitsparameters (-1 = onder Belgische standaard, 0 = gemiddeld, +1 = luxe). Een ridge-regressiemodel zet de scores om naar de afwerkingscoëfficiënt F (0.70–1.50)."
        />

        {/* F comparison */}
        <CompareTable>
          <CompareRow
            label="Afwerkingscoëfficiënt F"
            llm={fmtF(data.predicted_f)}
            expert={fmtF(data.expert_f)}
            delta={fDelta != null ? `${fDelta > 0 ? "+" : ""}${fDelta.toFixed(2)}` : "—"}
            status={getFStatus(fDelta)}
            highlight
          />
        </CompareTable>
        {gt?.expert_finishing_level && (
          <p className="pl-1 text-xs text-muted-foreground">
            Expert afwerkingsniveau (CED): <span className="font-medium">{gt.expert_finishing_level}</span> · Expert-F teruggerekend uit CED-totaalprijs.
          </p>
        )}

        {/* QQP scores grouped */}
        {hasQqp ? (
          <div className="space-y-4 pt-1">
            {data.qqpGroups.map((group) => {
              const items = group.items.filter((it) => data.qqpScores?.[it.name] != null);
              if (items.length === 0) return null;
              return (
                <div key={group.categoryName} className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.displayName}</p>
                  <div className="space-y-1.5">
                    {items.map((it) => {
                      const s = data.qqpScores![it.name];
                      return (
                        <div key={it.name} className="grid grid-cols-[minmax(0,1fr)_120px_44px] items-center gap-3 text-sm">
                          <span className="truncate" title={s.reasoning || it.displayName}>{it.displayName}</span>
                          <ScoreBar score={s.score} />
                          <span className={cn(
                            "text-right text-xs tabular-nums",
                            s.score > 0.1 ? "text-green-600" : s.score < -0.1 ? "text-orange-600" : "text-muted-foreground",
                          )}>
                            {s.score > 0 ? "+" : ""}{s.score.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="pl-1 text-sm text-muted-foreground">Geen QQP-scores beschikbaar voor deze run.</p>
        )}
      </div>

      {/* Step 4 — Unit prices per category */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <StepHeader
          n={4}
          icon={Euro}
          title="Eenheidsprijs per categorie (€/m²)"
          subtitle="De F bepaalt de eenheidsprijs per categorie via interpolatie tussen min/max. CAT1 (woon/appartement) is de belangrijkste."
        />
        <CompareTable>
          <CompareRow
            label="CAT1 — Woon/appartement €/m²"
            llm={fmtEur(llmPrices?.cat1)}
            expert={fmtEur(expertPrices?.cat1)}
            delta={fmtPct(cat1PriceErr)}
            status={getStatus(cat1PriceErr)}
            highlight
          />
          <CompareRow
            label="CAT2 — Bijgebouw €/m²"
            llm={fmtEur(llmPrices?.cat2)}
            expert={fmtEur(expertPrices?.cat2)}
            delta={fmtPct(cat2PriceErr)}
            status={getStatus(cat2PriceErr)}
          />
          <CompareRow
            label="CAT3 — Buiten €/m²"
            llm={fmtEur(llmPrices?.cat3)}
            expert={fmtEur(expertPrices?.cat3)}
            delta={fmtPct(cat3PriceErr)}
            status={getStatus(cat3PriceErr)}
          />
        </CompareTable>
        <div className="flex flex-wrap gap-x-6 gap-y-1 pl-1 text-xs text-muted-foreground">
          <span>Expert eenheidsprijzen zijn afgeleid uit de teruggerekende F (CED levert geen eenheidsprijzen per categorie).</span>
          {expertEffectivePerLivable != null && (
            <span>Reality-check: CED totaal / woonopp = <span className="font-medium text-foreground">{fmtEur(expertEffectivePerLivable)}/m²</span></span>
          )}
        </div>
      </div>

      {/* Step 5 — Total cost */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <StepHeader
          n={5}
          icon={Receipt}
          title="Totale herbouwkost"
          subtitle="Som van (m² × eenheidsprijs) per categorie, vermenigvuldigd met de regionale factor en de ABEX-index."
        />
        <CompareTable>
          <CompareRow
            label="Totale herbouwkost"
            llm={fmtEur(data.predicted_total_cost)}
            expert={fmtEur(gt?.expert_total_price)}
            delta={fmtPct(costErr)}
            status={getStatus(costErr)}
            highlight
          />
        </CompareTable>
        {externalFactor != null && (
          <p className="pl-1 text-xs text-muted-foreground">
            Afgeleide externe factor (regio × ABEX): <span className="font-medium text-foreground">×{externalFactor.toFixed(3)}</span>
            {llmSubtotal != null && <> · LLM-subtotaal vóór factoren: <span className="font-medium text-foreground">{fmtEur(llmSubtotal)}</span></>}
          </p>
        )}
      </div>
    </div>
  );
}
