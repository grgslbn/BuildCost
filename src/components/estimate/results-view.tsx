"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronUp,
  Download,
  RotateCcw,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { FINISHING_THRESHOLDS, F_MIN, F_MAX } from "@/lib/cost/calculate-cost";

// ── Types ─────────────────────────────────────────────────────────────────────

type CostBreakdown = {
  cat1_sqm: number;
  cat1_price_per_sqm: number;
  cat1_cost: number;
  cat2_sqm: number;
  cat2_price_per_sqm: number;
  cat2_cost: number;
  cat3_sqm: number;
  cat3_price_per_sqm: number;
  cat3_cost: number;
  subtotal: number;
  regional_factor: number;
  abex_factor: number;
  total_cost: number;
  finishing_coefficient: number;
  finishing_label: string;
  effective_price_per_livable_sqm: number;
};

export type EstimationResult = {
  id: string;
  status: string;
  building_type: string | null;
  total_livable_sqm: number | null;
  total_gross_sqm: number | null;
  finishing_level: string | null;
  finishing_coefficient: number | null;
  base_price_per_sqm: number | null;
  abex_factor: number | null;
  estimated_price_per_sqm: number | null;
  estimated_total_cost: number | null;
  sqm_confidence: number | null;
  qqp_confidence: number | null;
  overall_confidence: number | null;
  sqm_extraction: Record<string, unknown> | null;
  extracted_qqps: Record<string, { value: unknown; confidence?: number; notes?: string }> | null;
  sub_areas: CostBreakdown | null;
  postcode: string | null;
  plan_file_name: string | null;
  processing_time_ms: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEur(v: number | null, decimals = 0) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: decimals,
  }).format(v);
}

function formatNum(v: number | null, dec = 1) {
  if (v == null) return "—";
  return v.toFixed(dec);
}

function confidenceLabel(c: number | null) {
  if (c == null) return null;
  if (c >= 0.85) return { text: "High", color: "text-green-600" };
  if (c >= 0.65) return { text: "Medium", color: "text-amber-600" };
  return { text: "Low", color: "text-red-500" };
}

const LEVEL_META: Record<string, { label: string; color: string; bg: string }> = {
  basic:    { label: "Basic",    color: "text-slate-600",   bg: "bg-slate-100"   },
  standard: { label: "Standard", color: "text-blue-600",    bg: "bg-blue-50"     },
  comfort:  { label: "Comfort",  color: "text-emerald-600", bg: "bg-emerald-50"  },
  "comfort+": { label: "Comfort+", color: "text-orange-600", bg: "bg-orange-50"  },
  luxury:   { label: "Luxury",   color: "text-purple-600",  bg: "bg-purple-50"   },
};

const CATEGORY_LABELS: Record<string, string> = {
  living: "Living", bedroom: "Bedroom", bathroom: "Bathroom",
  toilet: "Toilet", kitchen: "Kitchen", dining: "Dining",
  office: "Office", utility: "Utility", hallway: "Hallway",
  stairs: "Stairs", garage: "Garage", storage: "Storage",
  terrace: "Terrace", balcony: "Balcony", garden: "Garden",
  dressing: "Dressing", laundry: "Laundry", wellness: "Wellness", other: "Other",
};

function FinishingMeter({ coeff }: { coeff: number }) {
  const range = F_MAX - F_MIN;
  const pct = ((coeff - F_MIN) / range) * 100;

  const segColors = [
    "bg-slate-300",
    "bg-blue-400",
    "bg-emerald-400",
    "bg-orange-400",
    "bg-purple-400",
  ];

  const segments = FINISHING_THRESHOLDS.map((t, i) => {
    const prev = i === 0 ? F_MIN : FINISHING_THRESHOLDS[i - 1].max;
    const curr = Math.min(t.max, F_MAX);
    return {
      label: t.label,
      from: ((prev - F_MIN) / range) * 100,
      to: ((curr - F_MIN) / range) * 100,
      color: segColors[i],
    };
  });

  return (
    <div className="space-y-1.5">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`absolute h-3 ${s.color} opacity-40`}
            style={{ left: `${s.from}%`, width: `${s.to - s.from}%` }}
          />
        ))}
        <div
          className="absolute top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-full bg-foreground shadow"
          style={{ left: `calc(${Math.min(98, Math.max(2, pct))}% - 3px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        {FINISHING_THRESHOLDS.map((t) => (
          <span key={t.label}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}

function ExpandSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40"
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

// ── Cost breakdown table ───────────────────────────────────────────────────────

function CostBreakdownTable({
  breakdown,
  postcodeMeta,
}: {
  breakdown: CostBreakdown;
  postcodeMeta?: { municipality?: string | null; region?: string | null };
}) {
  const rows = [
    {
      label: "CAT1 — Livable",
      sqm: breakdown.cat1_sqm,
      price: breakdown.cat1_price_per_sqm,
      cost: breakdown.cat1_cost,
    },
    {
      label: "CAT2 — Enclosed",
      sqm: breakdown.cat2_sqm,
      price: breakdown.cat2_price_per_sqm,
      cost: breakdown.cat2_cost,
    },
    {
      label: "CAT3 — Outdoor",
      sqm: breakdown.cat3_sqm,
      price: breakdown.cat3_price_per_sqm,
      cost: breakdown.cat3_cost,
    },
  ].filter((r) => r.sqm > 0);

  const location = [postcodeMeta?.municipality, postcodeMeta?.region]
    .filter(Boolean)
    .join(", ");

  return (
    <dl className="space-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-3 items-baseline gap-1">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="text-center tabular-nums text-muted-foreground text-xs">
            {formatNum(r.sqm)} m² × {formatEur(r.price)}
          </dd>
          <dd className="text-right font-medium tabular-nums">{formatEur(r.cost)}</dd>
        </div>
      ))}

      <Separator />

      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="font-medium tabular-nums">{formatEur(breakdown.subtotal)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-muted-foreground">
          Regional factor
          {location && <span className="ml-1 text-xs">({location})</span>}
        </dt>
        <dd className="font-medium tabular-nums">× {breakdown.regional_factor.toFixed(3)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-muted-foreground">ABEX factor</dt>
        <dd className="font-medium tabular-nums">× {breakdown.abex_factor.toFixed(3)}</dd>
      </div>

      <Separator />

      <div className="flex items-baseline justify-between gap-2 pt-0.5">
        <dt className="font-semibold">Total rebuild cost</dt>
        <dd className="text-lg font-bold tabular-nums text-primary">
          {formatEur(breakdown.total_cost)}
        </dd>
      </div>
      {breakdown.cat1_sqm > 0 && (
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Effective price / livable m²</dt>
          <dd className="font-medium tabular-nums text-primary">
            {formatEur(breakdown.effective_price_per_livable_sqm)} / m²
          </dd>
        </div>
      )}
    </dl>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResultsView({
  result,
  postcodeMeta,
  onReset,
}: {
  result: EstimationResult;
  postcodeMeta?: { municipality?: string | null; region?: string | null; nationalBase?: number };
  onReset: () => void;
}) {
  const breakdown = result.sub_areas;

  const levelKey = (result.finishing_level ?? "standard").toLowerCase();
  const level = LEVEL_META[levelKey] ?? LEVEL_META.standard;
  const confInfo = confidenceLabel(result.overall_confidence);

  const qqpData = result.extracted_qqps ?? {};
  type QQPEntry = { value: unknown; confidence?: number; notes?: string };

  type Room = {
    id: string;
    label_en?: string;
    label?: string;
    area_sqm?: number;
    category?: string;
    confidence?: number;
  };
  type Floor = { level: number; label_en?: string; rooms?: Room[] };
  const floors: Floor[] = ((result.sqm_extraction?.floors as Floor[]) ?? []);

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <div className="rounded-xl border bg-card px-8 py-8 text-center shadow-sm">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Estimated rebuild cost
        </p>
        <p className="mt-2 text-6xl font-bold tracking-tight">
          {formatEur(result.estimated_total_cost)}
        </p>
        {breakdown ? (
          <p className="mt-2 text-xl text-muted-foreground">
            {formatEur(breakdown.effective_price_per_livable_sqm)} / m² livable
          </p>
        ) : (
          <p className="mt-2 text-xl text-muted-foreground">
            {formatEur(result.estimated_price_per_sqm, 0)} / m²
          </p>
        )}
        {result.total_livable_sqm && (
          <p className="mt-1 text-sm text-muted-foreground">
            Based on {formatNum(result.total_livable_sqm)} m² livable area
          </p>
        )}
        {confInfo && (
          <p className={`mt-2 text-xs font-medium ${confInfo.color}`}>
            {confInfo.text} confidence — {Math.round((result.overall_confidence ?? 0) * 100)}%
          </p>
        )}
      </div>

      {/* ── Two-column cards ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Cost breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cost breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {breakdown ? (
              <CostBreakdownTable breakdown={breakdown} postcodeMeta={postcodeMeta} />
            ) : (
              <p className="text-sm text-muted-foreground">No breakdown available.</p>
            )}
          </CardContent>
        </Card>

        {/* Finishing level card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Finishing assessment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span
                  className={`rounded-md px-3 py-1 text-sm font-bold ${level.bg} ${level.color}`}
                >
                  {level.label}
                </span>
                <span className="ml-2 font-mono text-sm text-muted-foreground">
                  {(result.finishing_coefficient ?? 1).toFixed(3)}
                </span>
              </div>
            </div>

            <FinishingMeter coeff={result.finishing_coefficient ?? 1} />

            {/* Top indicators from QQP data */}
            <div className="space-y-3 pt-1">
              {(() => {
                const entries = Object.entries(qqpData) as [string, QQPEntry][];
                const withWeight = entries
                  .filter(([, v]) => v.value !== null && v.value !== undefined)
                  .sort((a, b) => (b[1].confidence ?? 0) - (a[1].confidence ?? 0));
                const top = withWeight.slice(0, 3);
                const bottom = withWeight.slice(-3).reverse();

                return (
                  <>
                    {top.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Strongest indicators
                        </p>
                        <ul className="space-y-1">
                          {top.map(([name, v]) => (
                            <li key={name} className="flex items-start gap-1.5 text-xs">
                              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                              <span>
                                <span className="font-medium capitalize">
                                  {name.replace(/_/g, " ")}
                                </span>
                                {v.value !== null && (
                                  <span className="ml-1 text-muted-foreground">
                                    {typeof v.value === "boolean"
                                      ? v.value ? "present" : "absent"
                                      : String(v.value)}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {bottom.length > 0 && top.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Weakest indicators
                        </p>
                        <ul className="space-y-1">
                          {bottom.map(([name, v]) => (
                            <li key={name} className="flex items-start gap-1.5 text-xs">
                              <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span>
                                <span className="font-medium capitalize">
                                  {name.replace(/_/g, " ")}
                                </span>
                                {v.value !== null && (
                                  <span className="ml-1 text-muted-foreground">
                                    {typeof v.value === "boolean"
                                      ? v.value ? "present" : "absent"
                                      : String(v.value)}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {result.qqp_confidence != null && (
              <p className="text-xs text-muted-foreground">
                QQP confidence:{" "}
                <span className="font-medium">
                  {Math.round(result.qqp_confidence * 100)}%
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Expandable sections ── */}
      <ExpandSection
        title={`Room breakdown${result.total_livable_sqm ? ` — ${formatNum(result.total_livable_sqm)} m² livable` : ""}`}
      >
        {floors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No room data available.</p>
        ) : (
          <div className="space-y-4">
            {floors.map((floor) => (
              <div key={floor.level}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {floor.label_en ?? `Floor ${floor.level}`}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Room</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Area</TableHead>
                      <TableHead className="text-right">Conf.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(floor.rooms ?? []).map((room) => (
                      <TableRow key={room.id}>
                        <TableCell className="font-medium">
                          {room.label_en ?? room.label ?? room.id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {CATEGORY_LABELS[room.category ?? "other"] ?? room.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {room.area_sqm != null ? `${room.area_sqm.toFixed(1)} m²` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {room.confidence != null
                            ? `${Math.round(room.confidence * 100)}%`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </ExpandSection>

      <ExpandSection
        title={`QQP values — ${Object.keys(qqpData).length} parameters extracted`}
      >
        {Object.keys(qqpData).length === 0 ? (
          <p className="text-sm text-muted-foreground">No QQP data available.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parameter</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(qqpData).map(([name, data]) => {
                const v = (data as QQPEntry).value;
                const conf = (data as QQPEntry).confidence;
                const displayVal =
                  v === null || v === undefined
                    ? <span className="text-muted-foreground">—</span>
                    : typeof v === "boolean"
                    ? v
                      ? <span className="text-emerald-600">Yes</span>
                      : <span className="text-muted-foreground">No</span>
                    : String(v);
                return (
                  <TableRow key={name}>
                    <TableCell className="capitalize">
                      {name.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">{displayVal}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {conf != null ? `${Math.round(conf * 100)}%` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ExpandSection>

      {/* ── Actions ── */}
      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" disabled>
          <Download className="mr-1.5 h-4 w-4" />
          Download report
          <span className="ml-1.5 text-xs text-muted-foreground">(coming soon)</span>
        </Button>
        <Button variant="ghost" onClick={onReset}>
          <RotateCcw className="mr-1.5 h-4 w-4" />
          New estimation
        </Button>
        {result.processing_time_ms && (
          <span className="ml-auto text-xs text-muted-foreground">
            Processed in {(result.processing_time_ms / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    </div>
  );
}
