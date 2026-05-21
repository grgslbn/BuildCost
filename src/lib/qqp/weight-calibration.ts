/**
 * Weight calibration — trains a Ridge regression model from reference dossiers.
 *
 * Pipeline:
 * 1. Load analyzed dossiers with known costs + valid SQM data
 * 2. Back-calculate F_true from known cost, areas, pricing, regional, ABEX
 * 3. Load QQP scores (new -1/+1 format) for each dossier
 * 4. Build feature matrix X (QQP scores) and target vector y (F_true)
 * 5. Cross-validate to find best lambda
 * 6. Train final Ridge model
 * 7. Store model version with intercept, weights, lambda, metrics
 */

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  trainRidge,
  predictRidge,
  crossValidateRidge,
} from "./ridge-regression";
import { backcalculateF } from "./f-backcalculate";
import { QQP_NAMES } from "./reference-ranges";
import { type PricingConfig, F_MIN, F_MAX } from "@/lib/cost/calculate-cost";

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

const LAMBDA_CANDIDATES = [0.001, 0.01, 0.1, 1, 10, 100];
const CV_FOLDS = 5;

/**
 * Train a Ridge regression model from reference dossiers.
 */
export async function calibrateWeights(): Promise<CalibrationResult> {
  const admin = createSupabaseAdminClient();

  // ── Load pricing config ──────────────────────────────────────────────────

  const { data: pricingRows } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", [
      "cat1_price_min",
      "cat1_price_max",
      "cat2_price_min",
      "cat2_price_max",
      "cat3_price_min",
      "cat3_price_max",
    ]);

  const pricingMap = Object.fromEntries(
    (pricingRows ?? []).map((r) => [r.key, Number(r.value)])
  );
  const pricing: PricingConfig = {
    cat1_min: pricingMap["cat1_price_min"] ?? 1100,
    cat1_max: pricingMap["cat1_price_max"] ?? 1900,
    cat2_min: pricingMap["cat2_price_min"] ?? 550,
    cat2_max: pricingMap["cat2_price_max"] ?? 950,
    cat3_min: pricingMap["cat3_price_min"] ?? 330,
    cat3_max: pricingMap["cat3_price_max"] ?? 570,
  };

  // ── Load dossiers with known costs ──────────────────────────────────────

  const { data: rawDossiers } = await admin
    .from("reference_dossiers")
    .select(
      "id, known_price_per_sqm, known_finishing_coefficient, sqm_extraction, regional_factor, abex_factor"
    )
    .eq("status", "analyzed")
    .not("sqm_extraction", "is", null)
    .or(
      "known_price_per_sqm.not.is.null,known_finishing_coefficient.not.is.null"
    );

  // Filter to dossiers with meaningful surface data
  const dossiers = (rawDossiers ?? []).filter((d) => {
    const sqm = d.sqm_extraction as Record<string, unknown> | null;
    if (!sqm) return false;
    const pt = sqm.project_totals as {
      total_cat1_sqm?: number;
      total_cat2_sqm?: number;
    } | undefined;
    if (pt) return (pt.total_cat1_sqm ?? 0) + (pt.total_cat2_sqm ?? 0) > 0;
    const summary = sqm.summary as { total_gross_sqm?: number } | undefined;
    return summary?.total_gross_sqm != null && summary.total_gross_sqm > 0;
  });

  if (dossiers.length < 5) {
    throw new Error(
      `Need at least 5 dossiers for training, found ${dossiers.length}.`
    );
  }

  // ── Back-calculate F_true for each dossier ──────────────────────────────

  const dossierFValues = new Map<string, number>();

  for (const d of dossiers) {
    // If we have a directly known coefficient, use it
    if (d.known_finishing_coefficient != null) {
      dossierFValues.set(
        d.id,
        Math.max(F_MIN, Math.min(F_MAX, d.known_finishing_coefficient))
      );
      continue;
    }

    // Otherwise, back-calculate from known price
    if (d.known_price_per_sqm == null) continue;

    const sqm = d.sqm_extraction as Record<string, unknown>;
    const pt = sqm.project_totals as {
      total_cat1_sqm?: number;
      total_cat2_sqm?: number;
      total_cat3_sqm?: number;
    } | undefined;

    const areas = {
      cat1_sqm: pt?.total_cat1_sqm ?? 0,
      cat2_sqm: pt?.total_cat2_sqm ?? 0,
      cat3_sqm: pt?.total_cat3_sqm ?? 0,
    };

    // Total cost = price/m² × cat1_sqm (livable area)
    const totalCost = d.known_price_per_sqm * areas.cat1_sqm;
    if (totalCost <= 0) continue;

    const regional = d.regional_factor ?? 1.0;
    const abex = d.abex_factor ?? 1.0;

    const result = backcalculateF(totalCost, areas, pricing, regional, abex);
    if (!result.isOutlier) {
      dossierFValues.set(d.id, result.f);
    }
  }

  if (dossierFValues.size < 5) {
    throw new Error(
      `Only ${dossierFValues.size} dossiers with valid F_true — need at least 5.`
    );
  }

  // ── Load QQP scores ─────────────────────────────────────────────────────

  const dossierIds = Array.from(dossierFValues.keys());

  const { data: qqpDefs } = await admin
    .from("qqp_definitions")
    .select("id, name")
    .eq("is_active", true);
  const defMap = new Map((qqpDefs ?? []).map((d) => [d.id, d.name]));

  const { data: qqpRows } = await admin
    .from("dossier_qqp_values")
    .select("dossier_id, qqp_id, value_numeric")
    .in("dossier_id", dossierIds);

  // Build per-dossier score maps
  const dossierScores = new Map<string, Record<string, number>>();
  for (const row of qqpRows ?? []) {
    const name = defMap.get(row.qqp_id);
    if (!name || row.value_numeric === null) continue;

    if (!dossierScores.has(row.dossier_id)) {
      dossierScores.set(row.dossier_id, {});
    }
    dossierScores.get(row.dossier_id)![name] = Number(row.value_numeric);
  }

  // ── Build feature matrix and target vector ──────────────────────────────

  const X: number[][] = [];
  const y: number[] = [];

  dossierFValues.forEach((fTrue, dossierId) => {
    const scores = dossierScores.get(dossierId);
    if (!scores) return;

    const row = QQP_NAMES.map((name) => scores[name] ?? 0);
    X.push(row);
    y.push(fTrue);
  });

  if (X.length < 5) {
    throw new Error(
      `Only ${X.length} complete training samples — need at least 5.`
    );
  }

  // ── Cross-validate and train ────────────────────────────────────────────

  const folds = Math.min(CV_FOLDS, X.length);
  const cvResult = crossValidateRidge(X, y, LAMBDA_CANDIDATES, folds);
  const bestLambda = cvResult.bestLambda;

  const model = trainRidge(X, y, bestLambda);

  // ── Compute training metrics ────────────────────────────────────────────

  let mae = 0;
  let mse = 0;
  const predictions: number[] = [];

  for (let i = 0; i < X.length; i++) {
    const pred = Math.max(F_MIN, Math.min(F_MAX, predictRidge(X[i], model)));
    predictions.push(pred);
    const err = Math.abs(pred - y[i]);
    mae += err;
    mse += err * err;
  }
  mae /= X.length;
  const rmse = Math.sqrt(mse / X.length);

  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((acc, v) => acc + (v - yMean) ** 2, 0);
  const ssRes = predictions.reduce((acc, p, i) => acc + (p - y[i]) ** 2, 0);
  const r_squared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // ── Store model version ─────────────────────────────────────────────────

  // Convert weights array to named map
  const namedWeights: Record<string, number> = {};
  for (let i = 0; i < QQP_NAMES.length; i++) {
    namedWeights[QQP_NAMES[i]] = model.weights[i] ?? 0;
  }

  const { data: maxVersionRow } = await admin
    .from("qqp_model_versions")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxVersionRow?.version ?? 0) + 1;

  // Get active QQP prompt version for linking
  const { data: activeQQPPrompt } = await admin
    .from("prompt_versions")
    .select("id")
    .eq("prompt_type", "qqp_extraction")
    .eq("is_active", true)
    .maybeSingle();

  const { data: newModel } = await admin
    .from("qqp_model_versions")
    .insert({
      version: nextVersion,
      weights: namedWeights,
      intercept: model.intercept,
      lambda: bestLambda,
      training_dossier_count: X.length,
      accuracy_metrics: {
        mae,
        rmse,
        r_squared,
        n_predictions: X.length,
        cv_scores: cvResult.scores,
      },
      prompt_version_id: activeQQPPrompt?.id ?? null,
      training_config: {
        cv_folds: folds,
        n_samples: X.length,
        feature_names: QQP_NAMES,
        lambda_candidates: LAMBDA_CANDIDATES,
        best_lambda: bestLambda,
      },
      notes: `Ridge regression (λ=${bestLambda}) from ${X.length} dossiers. MAE=${mae.toFixed(3)}, R²=${r_squared.toFixed(3)}.`,
      is_active: false,
    })
    .select("id")
    .single();

  if (!newModel?.id) throw new Error("Failed to insert new model version.");

  // Atomically flip active flag
  await admin
    .from("qqp_model_versions")
    .update({ is_active: false })
    .neq("id", newModel.id);
  await admin
    .from("qqp_model_versions")
    .update({ is_active: true })
    .eq("id", newModel.id);

  // ── Re-evaluate all analyzed dossiers ────────────────────────────────────

  const evalEntries = Array.from(dossierFValues.entries());
  for (let ei = 0; ei < evalEntries.length; ei++) {
    const [dossierId, fTrue] = evalEntries[ei];
    const scores = dossierScores.get(dossierId);
    if (!scores) continue;

    const x = QQP_NAMES.map((name) => scores[name] ?? 0);
    const predicted = Math.max(F_MIN, Math.min(F_MAX, predictRidge(x, model)));
    const predictionError = predicted - fTrue;

    await admin
      .from("reference_dossiers")
      .update({
        predicted_finishing_coefficient: predicted,
        prediction_error: predictionError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dossierId);
  }

  return {
    modelVersionId: newModel.id,
    version: nextVersion,
    dossiersUsed: X.length,
    qqpsCalibrated: QQP_NAMES.length,
    metrics: { mae, rmse, r_squared },
  };
}

// ── Check calibration trigger ─────────────────────────────────────────────────

/**
 * Returns true if enough new dossiers have been analyzed since the last
 * model version to warrant retraining.
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
