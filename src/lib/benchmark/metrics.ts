// src/lib/benchmark/metrics.ts
import type { RunMetrics } from "./types";

/**
 * (predicted - expert) / expert * 100. Returns null if either value is null or expert is 0.
 */
export function computeErrorPct(
  predicted: number | null,
  expert: number | null
): number | null {
  if (predicted == null || expert == null || expert === 0) return null;
  return ((predicted - expert) / expert) * 100;
}

type ResultForMetrics = {
  cost_error_pct: number | null;
  cat1_error_pct: number | null;
  cat2_error_pct: number | null;
  cat3_error_pct: number | null;
  f_error: number | null;
  error_message: string | null;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mae(values: (number | null)[]): number {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, v) => sum + Math.abs(v), 0) / valid.length;
}

export function computeRunMetrics(results: ResultForMetrics[]): RunMetrics {
  const succeeded = results.filter((r) => r.error_message == null);
  const failed = results.filter((r) => r.error_message != null);

  const costErrors = succeeded
    .map((r) => r.cost_error_pct)
    .filter((v): v is number => v != null);
  const absCostErrors = costErrors.map(Math.abs);

  const cat1Errors = succeeded.map((r) => r.cat1_error_pct);
  const cat2Errors = succeeded.map((r) => r.cat2_error_pct);
  const cat3Errors = succeeded.map((r) => r.cat3_error_pct);
  const fErrors = succeeded.map((r) => r.f_error);
  const absFErrors = fErrors.filter((v): v is number => v != null).map(Math.abs);

  const total = costErrors.length || 1; // avoid division by 0

  return {
    cost_mae_pct: mae(costErrors),
    cost_median_pct: median(absCostErrors),
    cost_worst_pct: absCostErrors.length > 0 ? Math.max(...absCostErrors) : 0,
    cost_within_10_pct: absCostErrors.filter((e) => e <= 10).length / total,
    cost_within_15_pct: absCostErrors.filter((e) => e <= 15).length / total,
    cat1_mae_pct: mae(cat1Errors),
    cat2_mae_pct: mae(cat2Errors),
    cat3_mae_pct: mae(cat3Errors),
    f_mae: absFErrors.length > 0 ? absFErrors.reduce((s, v) => s + v, 0) / absFErrors.length : 0,
    f_median: median(absFErrors),
    dossiers_succeeded: succeeded.length,
    dossiers_failed: failed.length,
  };
}
