/**
 * Model prediction module — applies a trained Ridge model to QQP scores
 * to predict the finishing coefficient (F).
 *
 * Replaces the old broken applyModelWeights / flattenQQPValues approach.
 */

import { predictRidge, type RidgeModel } from "./ridge-regression";
import { QQP_NAMES } from "./reference-ranges";
import { F_MIN, F_MAX } from "@/lib/cost/calculate-cost";

/** In-memory QQP score representation (matches new Claude output format) */
export type QQPScore = {
  score: number;
  confidence: number;
  reasoning: string;
};

/** Stored model from qqp_model_versions table */
export type StoredModel = {
  intercept: number;
  weights: Record<string, number>;
  lambda?: number;
  version?: number;
};

/**
 * Predict F from QQP scores using a trained Ridge model.
 *
 * @param qqpScores - QQP name → score pairs (from extraction)
 * @param model - Trained model (intercept + named weights)
 * @returns Clamped F value in [0.70, 1.50]
 */
export function predictF(
  qqpScores: Record<string, number>,
  model: StoredModel
): number {
  // Build feature vector in QQP_NAMES order
  const x = QQP_NAMES.map((name) => qqpScores[name] ?? 0);
  const weights = QQP_NAMES.map((name) => model.weights[name] ?? 0);

  const ridgeModel: RidgeModel = {
    intercept: model.intercept,
    weights,
  };

  const rawF = predictRidge(x, ridgeModel);
  return Math.max(F_MIN, Math.min(F_MAX, rawF));
}

/**
 * Flatten new-format QQP extraction output to a name→score map.
 *
 * Handles new format: { qqp_name: { score, confidence, reasoning } }
 */
export function flattenQQPScores(
  qqpValues:
    | Record<string, { score: number; confidence?: number; reasoning?: string }>
    | undefined
): Record<string, number> {
  if (!qqpValues) return {};
  const out: Record<string, number> = {};
  for (const [name, data] of Object.entries(qqpValues)) {
    if (data && typeof data.score === "number") {
      out[name] = data.score;
    }
  }
  return out;
}

/**
 * Convert a DB row (value_numeric, confidence, extraction_notes) to QQPScore.
 * Used when reading from dossier_qqp_values after migration.
 */
export function dbRowToScore(row: {
  value_numeric: number | null;
  confidence: number | null;
  extraction_notes: string | null;
}): QQPScore {
  return {
    score: row.value_numeric ?? 0,
    confidence: row.confidence ?? 0,
    reasoning: row.extraction_notes ?? "",
  };
}

// ─── Backward compatibility ──────────────────────────────────────────────

/**
 * @deprecated Use flattenQQPScores instead. Kept for old code paths during migration.
 */
export function flattenQQPValues(
  qqpValues:
    | Record<string, { value?: unknown; score?: number; confidence?: number }>
    | undefined
): Record<string, number> {
  if (!qqpValues) return {};
  const out: Record<string, number> = {};
  for (const [name, data] of Object.entries(qqpValues)) {
    // New format: { score }
    if (typeof data.score === "number") {
      out[name] = data.score;
      continue;
    }
    // Old format: { value }
    const v = data.value;
    if (typeof v === "number") out[name] = v;
    else if (typeof v === "boolean") out[name] = v ? 1 : 0;
  }
  return out;
}

/**
 * @deprecated Use predictF instead. Kept for old code paths during migration.
 */
export function applyModelWeights(
  qqpValues: Record<string, number>,
  _defs: Array<{ name: string; data_type: string }>,
  modelWeightsBlob: Record<string, unknown>
): number | null {
  // If the model has intercept/weights (new format), use predictF
  if (
    typeof modelWeightsBlob.intercept === "number" &&
    typeof modelWeightsBlob.weights === "object" &&
    modelWeightsBlob.weights !== null
  ) {
    return predictF(qqpValues, {
      intercept: modelWeightsBlob.intercept as number,
      weights: modelWeightsBlob.weights as Record<string, number>,
    });
  }
  // No valid model → null (caller should use F=1.0 fallback)
  return null;
}
