/**
 * Back-calculate F_true from a reference dossier's known total cost.
 *
 * Given: total_cost, areas (cat1/2/3), pricing config, regional + ABEX factors
 * Solve: total = (Σ area_i × price_i(F)) × regional × abex
 * where  price_i(F) = min_i + (F - 0.70) / 0.80 × (max_i - min_i)
 *
 * This is a closed-form linear solve (no iteration needed).
 */

import { type PricingConfig, F_MIN, F_MAX, DECOUPLE_CAT2_CAT3, CAT2_DECOUPLED_BASIS, CAT3_DECOUPLED_BASIS } from "@/lib/cost/calculate-cost";

type AreaInput = {
  cat1_sqm: number;
  cat2_sqm: number;
  cat3_sqm: number;
};

export type BackcalcResult = {
  /** Clamped F value in [0.70, 1.50] */
  f: number;
  /** True if rawF fell outside [0.70, 1.50] — useful for CAT price calibration */
  isOutlier: boolean;
  /** F value before clamping */
  rawF: number;
};

/**
 * Solve for F given known total cost and building parameters.
 *
 * @param totalCost - Known total reconstruction cost
 * @param areas - Surface areas per category (m²)
 * @param pricing - Min/max prices per category
 * @param regionalFactor - Regional postcode factor (typically 0.85–1.15)
 * @param abexFactor - ABEX construction index factor
 */
export function backcalculateF(
  totalCost: number,
  areas: AreaInput,
  pricing: PricingConfig,
  regionalFactor: number,
  abexFactor: number
): BackcalcResult {
  const externalFactors = regionalFactor * abexFactor;
  if (externalFactors === 0) return { f: 1.0, isOutlier: true, rawF: 1.0 };

  // Strip external factors to get the raw building cost
  const costBeforeFactors = totalCost / externalFactors;

  // Price ranges per category. When cat2/cat3 are decoupled, only cat1 scales
  // with F (cat2/cat3 stay fixed at their basis rate), so expert_f reflects the
  // living-space finish level only — consistent with the forward calculation.
  const range1 = pricing.cat1_max - pricing.cat1_min;
  const range2 = DECOUPLE_CAT2_CAT3 ? 0 : pricing.cat2_max - pricing.cat2_min;
  const range3 = DECOUPLE_CAT2_CAT3 ? 0 : pricing.cat3_max - pricing.cat3_min;
  // Fixed cat2/cat3 price used in the (decoupled) forward calc — mirror it here.
  const cat2Fixed = DECOUPLE_CAT2_CAT3
    ? Math.min(pricing.cat2_max, Math.max(pricing.cat2_min, CAT2_DECOUPLED_BASIS))
    : pricing.cat2_min;
  const cat3Fixed = DECOUPLE_CAT2_CAT3
    ? Math.min(pricing.cat3_max, Math.max(pricing.cat3_min, CAT3_DECOUPLED_BASIS))
    : pricing.cat3_min;

  // Cost at F_MIN (cat1 at min; cat2/cat3 at their fixed/decoupled rate)
  const minCost =
    areas.cat1_sqm * pricing.cat1_min +
    areas.cat2_sqm * cat2Fixed +
    areas.cat3_sqm * cat3Fixed;

  // How much cost increases per unit of r = (F - F_MIN) / (F_MAX - F_MIN)
  const rangeSlope =
    areas.cat1_sqm * range1 + areas.cat2_sqm * range2 + areas.cat3_sqm * range3;

  if (rangeSlope === 0) return { f: 1.0, isOutlier: true, rawF: 1.0 };

  // Solve: costBeforeFactors = minCost + r × rangeSlope
  const r = (costBeforeFactors - minCost) / rangeSlope;
  const rawF = F_MIN + r * (F_MAX - F_MIN);
  const isOutlier = rawF < F_MIN || rawF > F_MAX;
  const f = Math.max(F_MIN, Math.min(F_MAX, rawF));

  return { f, isOutlier, rawF };
}
