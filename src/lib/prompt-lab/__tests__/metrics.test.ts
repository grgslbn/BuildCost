// src/lib/benchmark/__tests__/metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  computeErrorPct,
  computeRunMetrics,
} from "../metrics";

describe("computeErrorPct", () => {
  it("returns percentage error", () => {
    expect(computeErrorPct(110, 100)).toBeCloseTo(10.0);
  });

  it("returns negative for under-prediction", () => {
    expect(computeErrorPct(90, 100)).toBeCloseTo(-10.0);
  });

  it("returns null when expert is null", () => {
    expect(computeErrorPct(100, null)).toBeNull();
  });

  it("returns null when expert is zero", () => {
    expect(computeErrorPct(100, 0)).toBeNull();
  });

  it("returns null when predicted is null", () => {
    expect(computeErrorPct(null, 100)).toBeNull();
  });
});

describe("computeRunMetrics", () => {
  const results = [
    { cost_error_pct: 5, cat1_error_pct: 3, cat2_error_pct: 8, cat3_error_pct: 10, f_error: 0.05, error_message: null },
    { cost_error_pct: -12, cat1_error_pct: -6, cat2_error_pct: 4, cat3_error_pct: -15, f_error: -0.10, error_message: null },
    { cost_error_pct: 8, cat1_error_pct: 2, cat2_error_pct: -3, cat3_error_pct: 5, f_error: 0.03, error_message: null },
    { cost_error_pct: null, cat1_error_pct: null, cat2_error_pct: null, cat3_error_pct: null, f_error: null, error_message: "Pipeline failed" },
  ];

  const metrics = computeRunMetrics(results);

  it("counts succeeded and failed", () => {
    expect(metrics.dossiers_succeeded).toBe(3);
    expect(metrics.dossiers_failed).toBe(1);
  });

  it("computes cost MAE from absolute values", () => {
    // |5| + |12| + |8| = 25, /3 = 8.33
    expect(metrics.cost_mae_pct).toBeCloseTo(8.33, 1);
  });

  it("computes cost median from absolute values", () => {
    // sorted absolute: [5, 8, 12] → median = 8
    expect(metrics.cost_median_pct).toBeCloseTo(8.0);
  });

  it("computes worst case", () => {
    expect(metrics.cost_worst_pct).toBeCloseTo(12.0);
  });

  it("computes within thresholds", () => {
    // 3 succeeded: 5%, 12%, 8% → all within 15%, 2/3 within 10%
    expect(metrics.cost_within_15_pct).toBeCloseTo(1.0);
    expect(metrics.cost_within_10_pct).toBeCloseTo(2 / 3, 2);
  });

  it("computes f MAE", () => {
    // |0.05| + |0.10| + |0.03| = 0.18, /3 = 0.06
    expect(metrics.f_mae).toBeCloseTo(0.06);
  });
});
