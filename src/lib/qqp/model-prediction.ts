/**
 * Applies calibrated model weights to a set of extracted QQP values to
 * produce a finishing coefficient prediction.
 * Used by the estimate API when a trained model version is available.
 */

type NormStats = { mean: number; std: number };

type ModelWeightsBlob = {
  _norm_stats?: Record<string, NormStats>;
  _mean_coeff?: number;
  _std_coeff?: number;
  [key: string]: unknown;
};

export function applyModelWeights(
  /** Raw QQP values: name → numeric value (booleans already converted to 0/1) */
  qqpValues: Record<string, number>,
  /** Active QQP definitions (need name + data_type) */
  defs: Array<{ name: string; data_type: string }>,
  /** weights JSONB from qqp_model_versions, including _norm_stats, _mean_coeff, _std_coeff */
  modelWeightsBlob: ModelWeightsBlob
): number | null {
  const {
    _norm_stats: normStats = {},
    _mean_coeff: meanCoeff = 1.0,
    _std_coeff: stdCoeff = 0.15,
    ...rawWeights
  } = modelWeightsBlob;

  let weightedSum = 0;
  let totalAbsWeight = 0;
  let n = 0;

  for (const def of defs) {
    const w = rawWeights[def.name];
    if (typeof w !== "number" || w === 0) continue;

    const val = qqpValues[def.name];
    if (val === undefined || val === null) continue;

    const stats = normStats[def.name];
    let normalized: number;

    if (def.data_type === "boolean") {
      normalized = val; // already 0 or 1
    } else if (stats && stats.std > 0) {
      normalized = Math.max(-2, Math.min(2, (val - stats.mean) / stats.std)) / 2;
    } else {
      continue;
    }

    weightedSum += w * normalized;
    totalAbsWeight += Math.abs(w);
    n++;
  }

  if (n === 0) return null;

  const scaleFactor = totalAbsWeight > 0 ? stdCoeff / totalAbsWeight : 0;
  const predicted = meanCoeff + weightedSum * scaleFactor;
  return Math.max(0.7, Math.min(1.5, predicted));
}

/**
 * Flatten extracted QQP values (from QQP extraction JSON) to a flat name→number map.
 * Handles numeric, boolean, and score types.
 */
export function flattenQQPValues(
  qqpValues: Record<string, { value: unknown; confidence?: number }> | undefined
): Record<string, number> {
  if (!qqpValues) return {};
  const out: Record<string, number> = {};
  for (const [name, data] of Object.entries(qqpValues)) {
    const v = data.value;
    if (typeof v === "number") out[name] = v;
    else if (typeof v === "boolean") out[name] = v ? 1 : 0;
  }
  return out;
}
