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
  const cat2Price = interpolatePrice(finishingCoeff, pricing.cat2_min, pricing.cat2_max);
  const cat3Price = interpolatePrice(finishingCoeff, pricing.cat3_min, pricing.cat3_max);

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
