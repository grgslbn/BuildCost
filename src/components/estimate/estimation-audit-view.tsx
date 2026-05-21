"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronDown, ChevronUp, ArrowLeft, PlusCircle,
} from "lucide-react";
import { FINISHING_THRESHOLDS, F_MIN, F_MAX } from "@/lib/cost/calculate-cost";

// ── Types ──────────────────────────────────────────────────────────────────────

type CostBreakdown = {
  cat1_sqm: number; cat1_price_per_sqm: number; cat1_cost: number;
  cat2_sqm: number; cat2_price_per_sqm: number; cat2_cost: number;
  cat3_sqm: number; cat3_price_per_sqm: number; cat3_cost: number;
  subtotal: number; regional_factor: number; abex_factor: number;
  total_cost: number; finishing_coefficient: number; finishing_label: string;
  effective_price_per_livable_sqm: number;
};

type QQPEntry = { score: number; confidence?: number; reasoning?: string };

type Room = {
  id?: string; label?: string; label_en?: string;
  area_sqm?: number; category?: string; confidence?: number;
};
type Floor  = { level?: number; label_en?: string; label?: string; rooms?: Room[] };
type Bldg   = { id?: string; name?: string; floors?: Floor[] };
type SqmExt = {
  floors?: Floor[]; buildings?: Bldg[];
  summary?: { total_livable_sqm?: number; total_gross_sqm?: number };
};

export type EstimationAuditData = {
  id: string;
  status: string;
  plan_file_name: string | null;
  postcode: string | null;
  created_at: string | null;
  building_type: string | null;
  total_livable_sqm: number | null;
  total_gross_sqm: number | null;
  finishing_level: string | null;
  finishing_coefficient: number | null;
  base_price_per_sqm: number | null;
  abex_factor: number | null;
  estimated_total_cost: number | null;
  sqm_confidence: number | null;
  qqp_confidence: number | null;
  overall_confidence: number | null;
  sqm_extraction: SqmExt | null;
  extracted_qqps: Record<string, QQPEntry> | null;
  sub_areas: CostBreakdown | null;
  processing_time_ms: number | null;
  model_version_id: string | null;
  error_message: string | null;
};

export type PricingSettings = {
  cat1_min: number; cat1_max: number;
  cat2_min: number; cat2_max: number;
  cat3_min: number; cat3_max: number;
};

export type QQPDef = { name: string; display_name: string | null; data_type: string };

export type PostcodeMeta = {
  municipality: string | null;
  region: string | null;
  base_price_per_sqm: number | null;
} | null;

export type ModelInfo = {
  id: string; version: number;
  weights: Record<string, unknown>;
} | null;

// ── Static maps ────────────────────────────────────────────────────────────────

const AREA_CAT: Record<string, "CAT1" | "CAT2" | "CAT3" | "EXCLUDED"> = {
  living: "CAT1", bedroom: "CAT1", bathroom: "CAT1", toilet: "CAT1",
  kitchen: "CAT1", dining: "CAT1", office: "CAT1", hallway: "CAT1",
  stairs: "CAT1", dressing: "CAT1", laundry: "CAT1", wellness: "CAT1", other: "CAT1",
  utility: "CAT2", garage: "CAT2", storage: "CAT2",
  terrace: "CAT3", balcony: "CAT3",
  garden: "EXCLUDED",
};

const CAT_STYLE: Record<string, { dot: string; bg: string; text: string }> = {
  CAT1:     { dot: "bg-blue-500",   bg: "bg-blue-50",   text: "text-blue-700"  },
  CAT2:     { dot: "bg-amber-500",  bg: "bg-amber-50",  text: "text-amber-700" },
  CAT3:     { dot: "bg-green-500",  bg: "bg-green-50",  text: "text-green-700" },
  EXCLUDED: { dot: "bg-slate-400",  bg: "bg-slate-100", text: "text-slate-500" },
};

const LEVEL_META: Record<string, { label: string; color: string; bg: string }> = {
  basic:      { label: "Basic",    color: "text-slate-600",   bg: "bg-slate-100"  },
  standard:   { label: "Standard", color: "text-blue-600",    bg: "bg-blue-50"    },
  comfort:    { label: "Comfort",  color: "text-emerald-600", bg: "bg-emerald-50" },
  "comfort+": { label: "Comfort+", color: "text-orange-600",  bg: "bg-orange-50"  },
  luxury:     { label: "Luxury",   color: "text-purple-600",  bg: "bg-purple-50"  },
};

const SEG_COLORS = ["bg-slate-300", "bg-blue-400", "bg-emerald-400", "bg-orange-400", "bg-purple-400"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function eur(v: number | null | undefined, dec = 0) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency", currency: "EUR", maximumFractionDigits: dec,
  }).format(v);
}

function pctStr(c: number | null) {
  if (c == null) return "—";
  return `${Math.round(c * 100)}%`;
}

function confBadge(c: number | null): { text: string; color: string } | null {
  if (c == null) return null;
  if (c >= 0.85) return { text: "High",   color: "text-green-600" };
  if (c >= 0.65) return { text: "Medium", color: "text-amber-600" };
  return           { text: "Low",    color: "text-red-500"   };
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-BE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function levelMeta(level: string | null) {
  return LEVEL_META[(level ?? "standard").toLowerCase()] ?? LEVEL_META.standard;
}

// ── Small visual primitives ────────────────────────────────────────────────────

function FinishingMeter({ coeff }: { coeff: number }) {
  const range = F_MAX - F_MIN;
  const marker = Math.min(98, Math.max(2, ((coeff - F_MIN) / range) * 100));
  const segs = FINISHING_THRESHOLDS.map((t, i) => {
    const prev = i === 0 ? F_MIN : FINISHING_THRESHOLDS[i - 1].max;
    const curr = Math.min(t.max, F_MAX);
    return { label: t.label, from: ((prev - F_MIN) / range) * 100, to: ((curr - F_MIN) / range) * 100, color: SEG_COLORS[i] };
  });
  return (
    <div className="space-y-1.5">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        {segs.map((s) => (
          <div key={s.label} className={`absolute h-3 ${s.color} opacity-50`}
            style={{ left: `${s.from}%`, width: `${s.to - s.from}%` }} />
        ))}
        <div className="absolute top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-full bg-foreground shadow"
          style={{ left: `calc(${marker}% - 3px)` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        {FINISHING_THRESHOLDS.map((t) => <span key={t.label}>{t.label}</span>)}
      </div>
    </div>
  );
}

function PriceBar({ min, max, actual }: { min: number; max: number; actual: number }) {
  const marker = Math.min(98, Math.max(2, ((actual - min) / (max - min)) * 100));
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full">
      <div className="absolute inset-0 bg-gradient-to-r from-slate-200 to-slate-600" />
      <div className="absolute top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-full bg-foreground shadow"
        style={{ left: `calc(${marker}% - 3px)` }} />
    </div>
  );
}

function ExpandSection({
  title, subtitle, count, defaultOpen = false, children,
}: {
  title: string; subtitle?: string; count?: number;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button type="button"
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-2.5">
          <span className="text-base font-semibold">{title}</span>
          {count != null && <Badge variant="secondary" className="text-xs">{count}</Badge>}
          {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
               : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && <div className="border-t px-6 pb-6 pt-5">{children}</div>}
    </Card>
  );
}

// ── Section 1: Hero ────────────────────────────────────────────────────────────

function HeroSection({ est, postcodeMeta }: { est: EstimationAuditData; postcodeMeta: PostcodeMeta }) {
  const bd = est.sub_areas;
  const lv = levelMeta(est.finishing_level);
  const ci = confBadge(est.overall_confidence);

  const allSqm = (bd?.cat1_sqm ?? 0) + (bd?.cat2_sqm ?? 0) + (bd?.cat3_sqm ?? 0);
  const pricePerTotal = allSqm > 0 ? Math.round((est.estimated_total_cost ?? 0) / allSqm) : null;
  const location = [postcodeMeta?.municipality, postcodeMeta?.region].filter(Boolean).join(", ");

  return (
    <Card className="overflow-hidden">
      {/* Dark header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-700 px-8 py-10 text-white">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Estimated Rebuild Cost
            </p>
            <p className="mt-2 text-5xl font-bold tracking-tight tabular-nums">
              {eur(est.estimated_total_cost)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-300">
              {bd && est.total_livable_sqm != null && (
                <span>{eur(bd.effective_price_per_livable_sqm)} / m² livable</span>
              )}
              {pricePerTotal && <span className="text-slate-500">|</span>}
              {pricePerTotal && (
                <span className="text-slate-400">{eur(pricePerTotal)} / m² total</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {est.building_type && (
              <span className="rounded-md bg-white/10 px-3 py-1 text-sm font-medium capitalize">
                {est.building_type.replace(/_/g, " ")}
              </span>
            )}
            <span className={`rounded-md px-3 py-1 text-sm font-bold ${lv.bg} ${lv.color}`}>
              {lv.label}
            </span>
          </div>
        </div>
      </div>
      {/* Meta bar */}
      <div className="flex flex-wrap items-center gap-5 px-8 py-3 text-sm border-t bg-muted/20">
        {est.plan_file_name && (
          <span className="font-medium text-foreground truncate max-w-sm">{est.plan_file_name}</span>
        )}
        {(est.postcode || location) && (
          <span className="text-muted-foreground">
            {est.postcode}{location ? ` — ${location}` : ""}
          </span>
        )}
        {est.created_at && (
          <span className="text-muted-foreground">{fmtDate(est.created_at)}</span>
        )}
        {ci && (
          <span className={`ml-auto text-xs font-semibold ${ci.color}`}>
            {ci.text} confidence — {pctStr(est.overall_confidence)}
          </span>
        )}
      </div>
    </Card>
  );
}

// ── Section 2: Cost Breakdown ──────────────────────────────────────────────────

function CostBreakdownSection({
  breakdown, postcodeMeta,
}: {
  breakdown: CostBreakdown;
  postcodeMeta: PostcodeMeta;
}) {
  const location = postcodeMeta?.municipality ?? postcodeMeta?.region;
  const rows = [
    { key: "CAT1", label: "CAT1 — Livable",          sqm: breakdown.cat1_sqm, price: breakdown.cat1_price_per_sqm, cost: breakdown.cat1_cost },
    { key: "CAT2", label: "CAT2 — Enclosed non-livable", sqm: breakdown.cat2_sqm, price: breakdown.cat2_price_per_sqm, cost: breakdown.cat2_cost },
    { key: "CAT3", label: "CAT3 — Outdoor built",     sqm: breakdown.cat3_sqm, price: breakdown.cat3_price_per_sqm, cost: breakdown.cat3_cost },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Breakdown</CardTitle>
        <CardDescription>
          Three-category calculation with regional and ABEX index adjustments
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Category</TableHead>
              <TableHead className="text-right">m²</TableHead>
              <TableHead className="text-right">€/m²</TableHead>
              <TableHead className="text-right pr-6">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const cs = CAT_STYLE[r.key];
              return (
                <TableRow key={r.key} className={r.sqm === 0 ? "opacity-40" : ""}>
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${cs.dot}`} />
                      <span className={r.sqm > 0 ? "font-medium" : "text-muted-foreground"}>{r.label}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.sqm > 0 ? r.sqm.toFixed(1) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.sqm > 0 ? eur(r.price) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium pr-6">
                    {r.sqm > 0 ? eur(r.cost) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Subtotal */}
            <TableRow className="border-t-2 border-border/60">
              <TableCell colSpan={3} className="pl-6 text-muted-foreground">Subtotal</TableCell>
              <TableCell className="text-right tabular-nums font-semibold pr-6">{eur(breakdown.subtotal)}</TableCell>
            </TableRow>

            {/* Regional */}
            <TableRow>
              <TableCell colSpan={3} className="pl-6 text-muted-foreground">
                × Regional coefficient
                {location && (
                  <span className="ml-1.5 text-xs">({location})</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground pr-6">
                × {breakdown.regional_factor != null ? Number(breakdown.regional_factor).toFixed(3) : "—"}
              </TableCell>
            </TableRow>

            {/* After regional */}
            {breakdown.regional_factor != null && breakdown.regional_factor !== 1 && (
              <TableRow className="bg-muted/10">
                <TableCell colSpan={3} className="pl-8 text-xs text-muted-foreground italic">
                  After regional adjustment
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm pr-6">
                  {eur(Math.round(breakdown.subtotal * Number(breakdown.regional_factor)))}
                </TableCell>
              </TableRow>
            )}

            {/* ABEX */}
            <TableRow>
              <TableCell colSpan={3} className="pl-6 text-muted-foreground">
                × ABEX index factor
                {breakdown.abex_factor != null && (
                  <span className="ml-1.5 text-xs">(index {Math.round(Number(breakdown.abex_factor) * 1000)})</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground pr-6">
                × {breakdown.abex_factor != null ? Number(breakdown.abex_factor).toFixed(3) : "—"}
              </TableCell>
            </TableRow>

            {/* Total */}
            <TableRow className="border-t-2 border-border/60 bg-muted/20">
              <TableCell colSpan={3} className="pl-6 font-bold text-base">Total Rebuild Cost</TableCell>
              <TableCell className="text-right tabular-nums font-bold text-lg text-primary pr-6">
                {eur(breakdown.total_cost)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

      </CardContent>
    </Card>
  );
}

// ── Section 3: Price formula ───────────────────────────────────────────────────

function PriceFormulaSection({
  breakdown, pricing,
}: {
  breakdown: CostBreakdown;
  pricing: PricingSettings;
}) {
  const f = Number(breakdown.finishing_coefficient);
  const lv = levelMeta(breakdown.finishing_label);

  const cats = [
    { key: "CAT1", label: "CAT1 — Livable",          min: pricing.cat1_min, max: pricing.cat1_max, actual: breakdown.cat1_price_per_sqm },
    { key: "CAT2", label: "CAT2 — Enclosed",          min: pricing.cat2_min, max: pricing.cat2_max, actual: breakdown.cat2_price_per_sqm },
    { key: "CAT3", label: "CAT3 — Outdoor built",     min: pricing.cat3_min, max: pricing.cat3_max, actual: breakdown.cat3_price_per_sqm },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price per m² Formula</CardTitle>
        <CardDescription>
          Linear interpolation from finishing coefficient F between the configured min and max prices
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* F value box + meter */}
        <div className="rounded-lg bg-muted/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Finishing Coefficient F
              </p>
              <p className="mt-0.5 font-mono text-3xl font-bold">{f.toFixed(3)}</p>
            </div>
            <span className={`rounded-md px-3 py-1.5 text-sm font-bold ${lv.bg} ${lv.color}`}>
              {lv.label}
            </span>
          </div>
          <FinishingMeter coeff={f} />
        </div>

        {/* Formula */}
        <div className="rounded-md border bg-slate-950 px-4 py-3 font-mono text-sm text-slate-300">
          <span className="text-slate-500">{"// "}</span>price per category:
          <br />
          price = min + (F − {F_MIN.toFixed(2)}) / ({F_MAX.toFixed(2)} − {F_MIN.toFixed(2)}) × (max − min)
        </div>

        {/* Category price table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Min (F={F_MIN})</TableHead>
              <TableHead className="text-right">Max (F={F_MAX})</TableHead>
              <TableHead className="text-right font-semibold">This building</TableHead>
              <TableHead className="w-40">Position</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cats.map((c) => {
              const cs = CAT_STYLE[c.key];
              return (
                <TableRow key={c.key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${cs.dot}`} />
                      <span className="font-medium">{c.label}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{eur(c.min)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{eur(c.max)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{eur(c.actual)}</TableCell>
                  <TableCell>
                    <PriceBar min={c.min} max={c.max} actual={c.actual} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Section 4: QQP evidence ────────────────────────────────────────────────────

function FinishingEvidenceSection({
  qqpData, qqpDefs, modelInfo,
}: {
  qqpData: Record<string, QQPEntry>;
  qqpDefs: QQPDef[];
  modelInfo: ModelInfo;
}) {
  const [showAll, setShowAll] = useState(false);

  const defMap = Object.fromEntries(qqpDefs.map((d) => [d.name, d]));

  // Extract feature weights (skip internal keys starting with _)
  const weights: Record<string, number> = {};
  if (modelInfo?.weights) {
    for (const [k, v] of Object.entries(modelInfo.weights)) {
      if (!k.startsWith("_") && typeof v === "number") weights[k] = v;
    }
  }

  type QQPRow = {
    name: string; displayName: string;
    score: number; confidence?: number; reasoning?: string; weight?: number;
  };

  const allRows: QQPRow[] = Object.entries(qqpData)
    .map(([name, e]) => ({
      name,
      displayName: defMap[name]?.display_name ?? name.replace(/_/g, " "),
      score: e.score,
      confidence: e.confidence,
      reasoning: e.reasoning,
      weight: weights[name],
    }))
    .sort((a, b) => Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0));

  const maxAbsW = Math.max(...allRows.map((r) => Math.abs(r.weight ?? 0)), 0.001);
  const displayRows = showAll ? allRows : allRows.slice(0, 12);

  function ScoreDisplay({ score }: { score: number }) {
    const color = score >= 0.5
      ? "text-amber-600" : score <= -0.5
      ? "text-blue-600" : "text-foreground";
    return (
      <span className={`font-mono font-semibold ${color}`}>
        {score > 0 ? "+" : ""}{score.toFixed(2)}
      </span>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle>Finishing Level Evidence</CardTitle>
            <CardDescription className="mt-1">
              Quality/Quantity Parameters extracted from the building plan — sorted by model impact
              {modelInfo && <span className="ml-2 text-xs font-medium">Model v{modelInfo.version}</span>}
            </CardDescription>
          </div>
          <Badge variant="secondary">{allRows.length} parameters</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {allRows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">No QQP data extracted.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Parameter</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="pr-6 w-36">Impact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((row) => {
                  const hasW = row.weight != null;
                  const wColor = !hasW
                    ? "text-muted-foreground"
                    : (row.weight ?? 0) > 0 ? "text-emerald-600" : "text-red-500";
                  const barPct = hasW ? (Math.abs(row.weight ?? 0) / maxAbsW) * 100 : 0;
                  return (
                    <TableRow key={row.name}>
                      <TableCell className="pl-6 font-medium capitalize">{row.displayName}</TableCell>
                      <TableCell>
                        <ScoreDisplay score={row.score} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground text-sm">
                        {row.confidence != null ? pctStr(row.confidence) : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-mono text-sm ${wColor}`}>
                        {hasW
                          ? `${(row.weight ?? 0) > 0 ? "+" : ""}${(row.weight ?? 0).toFixed(3)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="pr-6">
                        {hasW && barPct > 0 && (
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-2 rounded-full ${(row.weight ?? 0) > 0 ? "bg-emerald-400" : "bg-red-400"}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {allRows.length > 12 && (
              <div className="px-6 py-3 border-t">
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll
                    ? <><ChevronUp className="mr-1.5 h-4 w-4" />Show fewer</>
                    : <><ChevronDown className="mr-1.5 h-4 w-4" />Show all {allRows.length} parameters</>}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 5: Rooms ───────────────────────────────────────────────────────────

function RoomsContent({ sqmExt }: { sqmExt: SqmExt }) {
  const floors: Floor[] =
    sqmExt.buildings && sqmExt.buildings.length > 0
      ? sqmExt.buildings.flatMap((b) => b.floors ?? [])
      : sqmExt.floors ?? [];

  if (floors.length === 0)
    return <p className="text-sm text-muted-foreground">No room data available.</p>;

  return (
    <div className="space-y-8">
      {floors.map((floor, fi) => {
        const rooms = floor.rooms ?? [];
        const floorTotal = rooms.reduce((s, r) => s + (r.area_sqm ?? 0), 0);
        return (
          <div key={fi}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {floor.label_en ?? floor.label ?? `Floor ${floor.level ?? fi}`}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">{floorTotal.toFixed(1)} m²</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Cost cat.</TableHead>
                  <TableHead className="text-right">Area</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((room, ri) => {
                  const catKey = AREA_CAT[room.category ?? "other"] ?? "CAT1";
                  const cs = CAT_STYLE[catKey];
                  return (
                    <TableRow key={room.id ?? ri}>
                      <TableCell className="font-medium">
                        {room.label_en ?? room.label ?? `Room ${ri + 1}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm capitalize">
                        {room.category ?? "other"}
                      </TableCell>
                      <TableCell>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cs.bg} ${cs.text}`}>
                          {catKey === "EXCLUDED" ? "Excluded" : catKey}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {room.area_sqm != null ? `${room.area_sqm.toFixed(1)} m²` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground text-sm">
                        {room.confidence != null ? pctStr(room.confidence) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}

// ── Section 6: Metadata ────────────────────────────────────────────────────────

function MetadataSection({
  est, postcodeMeta, modelInfo,
}: {
  est: EstimationAuditData; postcodeMeta: PostcodeMeta; modelInfo: ModelInfo;
}) {
  const bd = est.sub_areas;
  const location = [postcodeMeta?.municipality, postcodeMeta?.region].filter(Boolean).join(", ");

  const confRows = [
    { label: "SQM extraction", val: est.sqm_confidence },
    { label: "QQP analysis",   val: est.qqp_confidence },
    { label: "Overall",        val: est.overall_confidence },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adjustments & Metadata</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {/* Regional */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Regional Coefficient
            </p>
            <p className="font-mono text-3xl font-bold">
              {bd?.regional_factor != null ? Number(bd.regional_factor).toFixed(3) : "—"}
            </p>
            {location && <p className="text-sm text-muted-foreground">{location}</p>}
            {est.postcode && <p className="text-xs text-muted-foreground">Postcode: {est.postcode}</p>}
            {postcodeMeta?.base_price_per_sqm != null && (
              <p className="text-xs text-muted-foreground">
                Regional base: {eur(postcodeMeta.base_price_per_sqm)} / m²
              </p>
            )}
          </div>

          {/* ABEX */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              ABEX Index Factor
            </p>
            <p className="font-mono text-3xl font-bold">
              {bd?.abex_factor != null ? Number(bd.abex_factor).toFixed(3) : "—"}
            </p>
            {bd?.abex_factor != null && (
              <p className="text-sm text-muted-foreground">
                Index value: {Math.round(Number(bd.abex_factor) * 1000)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">Reference: 1000</p>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Finishing Model
            </p>
            {modelInfo ? (
              <>
                <p className="font-mono text-3xl font-bold">v{modelInfo.version}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {modelInfo.id.slice(0, 8)}…
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-muted-foreground">AI direct</p>
                <p className="text-xs text-muted-foreground">No trained model available</p>
              </>
            )}
          </div>

          {/* Confidence */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Confidence Scores
            </p>
            {confRows.map(({ label, val }) => {
              const ci = confBadge(val);
              return (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className={`text-sm font-semibold ${ci?.color ?? "text-foreground"}`}>
                    {val != null ? `${pctStr(val)} — ${ci?.text ?? "—"}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Processing time */}
          {est.processing_time_ms != null && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Processing Time
              </p>
              <p className="font-mono text-3xl font-bold">
                {(est.processing_time_ms / 1000).toFixed(1)}s
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Root export ────────────────────────────────────────────────────────────────

export function EstimationAuditView({
  estimation,
  pricing,
  modelInfo,
  qqpDefs,
  postcodeMeta,
}: {
  estimation: EstimationAuditData;
  pricing: PricingSettings;
  modelInfo: ModelInfo;
  qqpDefs: QQPDef[];
  postcodeMeta: PostcodeMeta;
}) {
  const bd    = estimation.sub_areas;
  const sqmExt = estimation.sqm_extraction;
  const qqpData = estimation.extracted_qqps ?? {};

  const floors: Floor[] = sqmExt
    ? sqmExt.buildings?.flatMap((b) => b.floors ?? []) ?? sqmExt.floors ?? []
    : [];
  const roomCount = floors.reduce((s, f) => s + (f.rooms?.length ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Nav bar */}
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/estimations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All Estimations
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/estimate">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Estimation
          </Link>
        </Button>
      </div>

      {/* S1 */}
      <HeroSection est={estimation} postcodeMeta={postcodeMeta} />

      {/* S2 */}
      {bd && <CostBreakdownSection breakdown={bd} postcodeMeta={postcodeMeta} />}

      {/* S3 */}
      {bd && <PriceFormulaSection breakdown={bd} pricing={pricing} />}

      {/* S4 */}
      {Object.keys(qqpData).length > 0 && (
        <FinishingEvidenceSection qqpData={qqpData} qqpDefs={qqpDefs} modelInfo={modelInfo} />
      )}

      {/* S5 */}
      {sqmExt && roomCount > 0 && (
        <ExpandSection
          title="Room-by-Room Extraction"
          count={roomCount}
          subtitle={estimation.total_livable_sqm != null
            ? `— ${estimation.total_livable_sqm.toFixed(1)} m² livable`
            : undefined}
        >
          <RoomsContent sqmExt={sqmExt} />
        </ExpandSection>
      )}

      {/* S6 */}
      <MetadataSection est={estimation} postcodeMeta={postcodeMeta} modelInfo={modelInfo} />

      {/* Separator */}
      <Separator />
      <p className="text-center text-xs text-muted-foreground">
        Estimation ID: <span className="font-mono">{estimation.id}</span>
      </p>
    </div>
  );
}
