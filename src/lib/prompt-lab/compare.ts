/**
 * Shared comparison helpers for the Prompt Lab dossier walkthrough.
 *
 * Pure functions only (no JSX) — formatting, status thresholds, and
 * unit-price derivation. Re-uses the pricing curve from calculate-cost.
 */

import { interpolatePrice, type PricingConfig } from "@/lib/cost/calculate-cost";

export type StatusLevel = "match" | "close" | "warning" | "error" | "na";

/** Signed error percentage of `value` vs `expert` ((value-expert)/expert*100). */
export function computeError(
  value: number | null | undefined,
  expert: number | null | undefined,
): number | null {
  if (value == null || expert == null || expert === 0) return null;
  return ((value - expert) / expert) * 100;
}

/** Map an absolute error % to a status level. */
export function getStatus(errorPct: number | null): StatusLevel {
  if (errorPct == null) return "na";
  const abs = Math.abs(errorPct);
  if (abs <= 5) return "match";
  if (abs <= 15) return "close";
  if (abs <= 30) return "warning";
  return "error";
}

export function statusLabel(status: StatusLevel): string {
  switch (status) {
    case "match": return "Exact (≤5%)";
    case "close": return "Dichtbij (≤15%)";
    case "warning": return "Afwijking (≤30%)";
    case "error": return "Groot verschil";
    case "na": return "Geen data";
  }
}

export function statusColor(status: StatusLevel): string {
  switch (status) {
    case "match": return "text-green-600";
    case "close": return "text-amber-600";
    case "warning": return "text-orange-600";
    case "error": return "text-red-600 font-medium";
    case "na": return "text-muted-foreground";
  }
}

export function fmtSqm(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} m²`;
}

export function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function fmtF(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

/** LLM/expert unit price per category (€/m²) at a given finishing coefficient F. */
export function categoryUnitPrices(
  f: number | null | undefined,
  pricing: PricingConfig,
): { cat1: number; cat2: number; cat3: number } | null {
  if (f == null) return null;
  return {
    cat1: Math.round(interpolatePrice(f, pricing.cat1_min, pricing.cat1_max)),
    cat2: Math.round(interpolatePrice(f, pricing.cat2_min, pricing.cat2_max)),
    cat3: Math.round(interpolatePrice(f, pricing.cat3_min, pricing.cat3_max)),
  };
}

/**
 * Rough reality-check: expert €/m² of livable area = total price / CAT1 m².
 * CAT1 (woon/appartement) is the most important unit price per the spec.
 */
export function expertEffectivePerLivableSqm(
  expertTotalPrice: number | null | undefined,
  expertCat1Sqm: number | null | undefined,
): number | null {
  if (!expertTotalPrice || !expertCat1Sqm) return null;
  return Math.round(expertTotalPrice / expertCat1Sqm);
}
