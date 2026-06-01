import type { AreaBreakdown } from "./area-categories";

export const F_MIN = 0.70;
export const F_MAX = 1.50;

export const FINISHING_THRESHOLDS = [
  { label: "Basic",    max: 0.88 },
  { label: "Standard", max: 1.06 },
  { label: "Comfort",  max: 1.20 },
  { label: "Comfort+", max: 1.38 },
  { label: "Luxury",   max: Infinity },
];

export type PricingConfig = {
  cat1_min: number;
  cat1_max: number;
  cat2_min: number;
  cat2_max: number;
  cat3_min: number;
  cat3_max: number;
};

export type CostBreakdown = {
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

export function interpolatePrice(
  f: number,
  priceMin: number,
  priceMax: number
): number {
  const ratio = (f - F_MIN) / (F_MAX - F_MIN);
  return priceMin + ratio * (priceMax - priceMin);
}

/**
 * Whether cat2 (enclosed non-livable) and cat3 (outdoor) prices scale with the
 * finishing coefficient F.
 *
 * cat2 (garage/storage) and cat3 (terrace) are priced INDEPENDENTLY of the
 * apartment's finishing level — a luxury apartment does not make its garage more
 * expensive. Coupling F to all three categories over-predicted garage-heavy
 * buildings. When decoupled, cat2/cat3 use a fixed BASIS rate (P50), not the min.
 *
 * Basis rates MAE-optimized on the apartment benchmark (bench-selectie.json,
 * 20-22 dossiers, docs/benchmark-2026-05-31.md):
 *   cat2 (garage/kelder/berging): median €1.227, MAE-optimal €1.200 (vs €900→411, €1100→278, €1200→247)
 *   cat3 (terras/balkon):         median €750,   MAE-optimal €700  (vs €500→237, €700→215, €900→253)
 * (The eenheidsprijzen overview's €1100/€900 P50 were close; the per-dossier MAE
 *  on the curated apartment set lands at €1200/€700.)
 */
export const DECOUPLE_CAT2_CAT3 = true;
/** Fixed decoupled prices — MAE-optimal on the apartment benchmark. */
export const CAT2_DECOUPLED_BASIS = 1200;
export const CAT3_DECOUPLED_BASIS = 700;

export function getFinishingLabel(f: number): string {
  for (const t of FINISHING_THRESHOLDS) {
    if (f <= t.max) return t.label;
  }
  return "Luxury";
}

export function calculateCost(
  areas: AreaBreakdown,
  finishingCoeff: number,
  pricing: PricingConfig,
  regionalFactor: number,
  abexFactor: number
): CostBreakdown {
  const cat1Price = interpolatePrice(finishingCoeff, pricing.cat1_min, pricing.cat1_max);
  // cat2/cat3 are finish-independent (basis P50 rate) when decoupled — see DECOUPLE_CAT2_CAT3.
  // Clamp the basis to the configured [min,max] so Settings still bounds it.
  const cat2Price = DECOUPLE_CAT2_CAT3
    ? Math.min(pricing.cat2_max, Math.max(pricing.cat2_min, CAT2_DECOUPLED_BASIS))
    : interpolatePrice(finishingCoeff, pricing.cat2_min, pricing.cat2_max);
  const cat3Price = DECOUPLE_CAT2_CAT3
    ? Math.min(pricing.cat3_max, Math.max(pricing.cat3_min, CAT3_DECOUPLED_BASIS))
    : interpolatePrice(finishingCoeff, pricing.cat3_min, pricing.cat3_max);

  const cat1Cost = areas.cat1_sqm * cat1Price;
  const cat2Cost = areas.cat2_sqm * cat2Price;
  const cat3Cost = areas.cat3_sqm * cat3Price;
  const subtotal = cat1Cost + cat2Cost + cat3Cost;

  const total = subtotal * regionalFactor * abexFactor;

  const effectivePricePerLivable =
    areas.cat1_sqm > 0 ? total / areas.cat1_sqm : 0;

  return {
    cat1_sqm: areas.cat1_sqm,
    cat1_price_per_sqm: Math.round(cat1Price),
    cat1_cost: Math.round(cat1Cost),
    cat2_sqm: areas.cat2_sqm,
    cat2_price_per_sqm: Math.round(cat2Price),
    cat2_cost: Math.round(cat2Cost),
    cat3_sqm: areas.cat3_sqm,
    cat3_price_per_sqm: Math.round(cat3Price),
    cat3_cost: Math.round(cat3Cost),
    subtotal: Math.round(subtotal),
    regional_factor: regionalFactor,
    abex_factor: abexFactor,
    total_cost: Math.round(total),
    finishing_coefficient: finishingCoeff,
    finishing_label: getFinishingLabel(finishingCoeff),
    effective_price_per_livable_sqm: Math.round(effectivePricePerLivable),
  };
}
