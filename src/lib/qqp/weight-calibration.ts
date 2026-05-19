import { createSupabaseAdminClient } from "@/lib/supabase/server";

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[], m: number): number {
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type CalibrationResult = {
  modelVersionId: string;
  version: number;
  dossiersUsed: number;
  qqpsCalibrated: number;
  metrics: {
    mae: number;
    rmse: number;
    r_squared: number;
  };
};

type NormStats = {
  mean: number;
  std: number;
};

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Computes Pearson correlations between each QQP and the known finishing
 * coefficient, stores weights in qqp_definitions, creates a model version
 * snapshot, and re-evaluates predicted_finishing_coefficient for all
 * analyzed dossiers.
 */
export async function calibrateWeights(): Promise<CalibrationResult> {
  const admin = createSupabaseAdminClient();

  // Read national base price from settings
  const { data: basePriceRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "national_base_price_sqm")
    .single();
  const nationalBasePrice = (basePriceRow?.value as number) ?? 1450;

  // Load analyzed dossiers with a known price
  const { data: dossiers } = await admin
    .from("reference_dossiers")
    .select("id, known_price_per_sqm, known_finishing_coefficient")
    .eq("status", "analyzed")
    .or("known_price_per_sqm.not.is.null,known_finishing_coefficient.not.is.null");

  if (!dossiers || dossiers.length === 0) {
    throw new Error("No analyzed dossiers with known prices — cannot calibrate.");
  }

  // Compute effective coefficient for each dossier
  const effectiveCoeffs = new Map<string, number>();
  for (const d of dossiers) {
    let coeff: number | null = null;
    if (d.known_finishing_coefficient != null) {
      coeff = d.known_finishing_coefficient;
    } else if (d.known_price_per_sqm != null && nationalBasePrice > 0) {
      coeff = d.known_price_per_sqm / nationalBasePrice;
    }
    if (coeff != null && coeff > 0) effectiveCoeffs.set(d.id, coeff);
  }

  if (effectiveCoeffs.size === 0) {
    throw new Error("Could not compute effective coefficients for any dossier.");
  }

  const dossierIdsWithCoeff = Array.from(effectiveCoeffs.keys());

  // Load QQP values for those dossiers
  const { data: qqpValues } = await admin
    .from("dossier_qqp_values")
    .select("dossier_id, qqp_id, value_numeric, value_boolean")
    .in("dossier_id", dossierIdsWithCoeff);

  // Load active QQP definitions
  const { data: qqpDefs } = await admin
    .from("qqp_definitions")
    .select("id, name, data_type")
    .eq("is_active", true);

  const defs = qqpDefs ?? [];
  const values = qqpValues ?? [];

  // Group QQP values by qqp_id → map dossierId → numeric value
  const valuesByQQP = new Map<string, Map<string, number>>();
  for (const v of values) {
    let num: number | null = null;
    if (v.value_numeric != null) num = Number(v.value_numeric);
    else if (v.value_boolean != null) num = v.value_boolean ? 1 : 0;
    if (num === null) continue;

    if (!valuesByQQP.has(v.qqp_id)) valuesByQQP.set(v.qqp_id, new Map());
    valuesByQQP.get(v.qqp_id)!.set(v.dossier_id, num);
  }

  // Calibrate each QQP
  const weights: Record<string, number> = {};
  const normStats: Record<string, NormStats> = {};
  let calibratedCount = 0;

  for (const def of defs) {
    const qqpMap = valuesByQQP.get(def.id);
    if (!qqpMap || qqpMap.size < 3) {
      weights[def.name] = 0;
      continue;
    }

    const pairs: [number, number][] = [];
    for (const [dossierId, val] of Array.from(qqpMap.entries())) {
      const coeff = effectiveCoeffs.get(dossierId);
      if (coeff != null) pairs.push([val, coeff]);
    }

    if (pairs.length < 3) {
      weights[def.name] = 0;
      continue;
    }

    const xs = pairs.map((p) => p[0]);
    const ys = pairs.map((p) => p[1]);

    const r = pearson(xs, ys);
    const confidence = Math.min(1, pairs.length / 30);

    const mx = mean(xs);
    const sx = stddev(xs, mx);
    normStats[def.name] = { mean: mx, std: sx };

    await admin
      .from("qqp_definitions")
      .update({
        weight: r,
        weight_confidence: confidence,
        updated_at: new Date().toISOString(),
      })
      .eq("id", def.id);

    weights[def.name] = r;
    calibratedCount++;
  }

  // ── Build model version snapshot ──────────────────────────────────────────

  const coeffValues = Array.from(effectiveCoeffs.values());
  const meanCoeff = mean(coeffValues);
  const stdCoeff = stddev(coeffValues, meanCoeff);

  // Compute predictions on training set using weighted z-score model
  const predictions: number[] = [];
  const actuals: number[] = [];

  for (const dossierId of dossierIdsWithCoeff) {
    const actual = effectiveCoeffs.get(dossierId)!;
    const predicted = predictCoefficient(
      dossierId,
      defs,
      valuesByQQP,
      weights,
      normStats,
      meanCoeff,
      stdCoeff
    );
    if (predicted !== null) {
      predictions.push(predicted);
      actuals.push(actual);
    }
  }

  const n = predictions.length;
  let mae = 0, mse = 0;
  for (let i = 0; i < n; i++) {
    const err = Math.abs(predictions[i] - actuals[i]);
    mae += err;
    mse += err * err;
  }
  mae = n > 0 ? mae / n : 0;
  const rmse = n > 0 ? Math.sqrt(mse / n) : 0;

  // R² on training set
  const meanActual = n > 0 ? mean(actuals) : meanCoeff;
  const ssTot = actuals.reduce((acc, a) => acc + (a - meanActual) ** 2, 0);
  const ssRes = predictions.reduce(
    (acc, p, i) => acc + (p - actuals[i]) ** 2,
    0
  );
  const r_squared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Deactivate previous versions
  await admin
    .from("qqp_model_versions")
    .update({ is_active: false })
    .eq("is_active", true);

  const { data: maxVersionRow } = await admin
    .from("qqp_model_versions")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxVersionRow?.version ?? 0) + 1;

  const { data: newModel } = await admin
    .from("qqp_model_versions")
    .insert({
      version: nextVersion,
      weights: { ...weights, _norm_stats: normStats, _mean_coeff: meanCoeff, _std_coeff: stdCoeff },
      training_dossier_count: effectiveCoeffs.size,
      accuracy_metrics: { mae, rmse, r_squared, n_predictions: n },
      notes: `Auto-calibrated from ${effectiveCoeffs.size} dossiers. ${calibratedCount} QQPs calibrated.`,
      is_active: true,
    })
    .select("id")
    .single();

  // ── Re-evaluate all analyzed dossiers ────────────────────────────────────

  const { data: allAnalyzed } = await admin
    .from("reference_dossiers")
    .select("id, known_price_per_sqm, known_finishing_coefficient")
    .eq("status", "analyzed");

  for (const dossier of allAnalyzed ?? []) {
    const qqpDossierId = dossier.id;
    const predicted = predictCoefficient(
      qqpDossierId,
      defs,
      valuesByQQP,
      weights,
      normStats,
      meanCoeff,
      stdCoeff
    );

    if (predicted === null) continue;

    let predictionError: number | null = null;
    if (dossier.known_finishing_coefficient != null) {
      predictionError = predicted - dossier.known_finishing_coefficient;
    } else if (dossier.known_price_per_sqm != null && nationalBasePrice > 0) {
      predictionError = predicted - dossier.known_price_per_sqm / nationalBasePrice;
    }

    await admin
      .from("reference_dossiers")
      .update({
        predicted_finishing_coefficient: predicted,
        prediction_error: predictionError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", qqpDossierId);
  }

  return {
    modelVersionId: newModel?.id ?? "",
    version: nextVersion,
    dossiersUsed: effectiveCoeffs.size,
    qqpsCalibrated: calibratedCount,
    metrics: { mae, rmse, r_squared },
  };
}

// ── Prediction model ──────────────────────────────────────────────────────────

/**
 * Predicts the finishing coefficient for a dossier using the calibrated weights.
 * Uses a z-score weighted model centered on the training mean coefficient.
 */
function predictCoefficient(
  dossierId: string,
  defs: Array<{ id: string; name: string; data_type: string }>,
  valuesByQQP: Map<string, Map<string, number>>,
  weights: Record<string, number>,
  normStats: Record<string, NormStats>,
  meanCoeff: number,
  stdCoeff: number
): number | null {
  let weightedSum = 0;
  let totalAbsWeight = 0;
  let n = 0;

  for (const def of defs) {
    const w = weights[def.name];
    if (!w || w === 0) continue;

    const qqpMap = valuesByQQP.get(def.id);
    const val = qqpMap?.get(dossierId);
    if (val === undefined) continue;

    const stats = normStats[def.name];
    let normalized: number;

    if (def.data_type === "boolean") {
      normalized = val; // 0 or 1
    } else if (stats && stats.std > 0) {
      // Z-score, clamped to [-2, 2]
      normalized = Math.max(-2, Math.min(2, (val - stats.mean) / stats.std)) / 2;
    } else {
      continue;
    }

    weightedSum += w * normalized;
    totalAbsWeight += Math.abs(w);
    n++;
  }

  if (n === 0) return null;

  // Scale contribution: at full correlation (weight=1) and z=1, shift by stdCoeff
  const scaleFactor = totalAbsWeight > 0 ? stdCoeff / totalAbsWeight : 0;
  const predicted = meanCoeff + weightedSum * scaleFactor;

  // Clamp to valid range
  return Math.max(0.7, Math.min(1.5, predicted));
}

// ── Check calibration trigger ─────────────────────────────────────────────────

/**
 * Returns true if the count of dossiers analyzed since the last model version
 * has reached the calibration_interval threshold.
 */
export async function shouldAutoCalibrate(): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  const { data: intervalRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "calibration_interval")
    .single();
  const interval = (intervalRow?.value as number) ?? 10;

  const { data: lastModel } = await admin
    .from("qqp_model_versions")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let countQuery = admin
    .from("reference_dossiers")
    .select("id", { count: "exact", head: true })
    .eq("status", "analyzed");

  if (lastModel?.created_at) {
    countQuery = countQuery.gt("updated_at", lastModel.created_at);
  }

  const { count } = await countQuery;
  return (count ?? 0) >= interval;
}
