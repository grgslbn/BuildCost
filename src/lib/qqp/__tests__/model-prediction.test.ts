import { describe, it, expect } from "vitest";
import {
  predictF,
  flattenQQPScores,
  flattenQQPValues,
  dbRowToScore,
} from "../model-prediction";

describe("predictF", () => {
  it("returns clamped F from QQP scores and model weights", () => {
    const model = {
      intercept: 1.0,
      weights: { kitchen_sqm: 0.1, has_wellness: 0.15 },
    };
    const scores = { kitchen_sqm: 0.5, has_wellness: 0.8 };
    const f = predictF(scores, model);
    // 1.0 + 0.1*0.5 + 0.15*0.8 = 1.0 + 0.05 + 0.12 = 1.17
    expect(f).toBeCloseTo(1.17, 2);
  });

  it("clamps to F_MIN when predicted is too low", () => {
    const model = {
      intercept: 0.5,
      weights: { kitchen_sqm: -0.2 },
    };
    const scores = { kitchen_sqm: 1.0 };
    const f = predictF(scores, model);
    expect(f).toBe(0.7);
  });

  it("clamps to F_MAX when predicted is too high", () => {
    const model = {
      intercept: 1.4,
      weights: { has_wellness: 0.5 },
    };
    const scores = { has_wellness: 1.0 };
    const f = predictF(scores, model);
    expect(f).toBe(1.5);
  });

  it("missing QQP scores default to 0", () => {
    const model = {
      intercept: 1.1,
      weights: { kitchen_sqm: 0.1, has_wellness: 0.2 },
    };
    // Only provide one QQP
    const scores = { kitchen_sqm: 0.5 };
    const f = predictF(scores, model);
    // 1.1 + 0.1*0.5 + 0.2*0 = 1.15
    expect(f).toBeCloseTo(1.15, 2);
  });
});

describe("flattenQQPScores", () => {
  it("extracts score from new format", () => {
    const values = {
      kitchen_sqm: { score: 0.3, confidence: 0.9, reasoning: "good" },
      has_wellness: { score: -0.5, confidence: 0.7, reasoning: "absent" },
    };
    const flat = flattenQQPScores(values);
    expect(flat.kitchen_sqm).toBe(0.3);
    expect(flat.has_wellness).toBe(-0.5);
  });

  it("returns empty for undefined input", () => {
    expect(flattenQQPScores(undefined)).toEqual({});
  });
});

describe("flattenQQPValues (backward compat)", () => {
  it("handles old boolean format", () => {
    const values = {
      has_dressing: { value: true, confidence: 0.9 },
      has_wellness: { value: false, confidence: 0.8 },
    };
    const flat = flattenQQPValues(values);
    expect(flat.has_dressing).toBe(1);
    expect(flat.has_wellness).toBe(0);
  });

  it("handles new score format", () => {
    const values = {
      kitchen_sqm: { score: 0.4, confidence: 0.9 },
    };
    const flat = flattenQQPValues(values);
    expect(flat.kitchen_sqm).toBe(0.4);
  });
});

describe("dbRowToScore", () => {
  it("converts DB row to QQPScore object", () => {
    const row = {
      value_numeric: 0.35,
      confidence: 0.8,
      extraction_notes: "good kitchen",
    };
    const score = dbRowToScore(row);
    expect(score).toEqual({
      score: 0.35,
      confidence: 0.8,
      reasoning: "good kitchen",
    });
  });

  it("handles null values with defaults", () => {
    const row = {
      value_numeric: null,
      confidence: null,
      extraction_notes: null,
    };
    const score = dbRowToScore(row);
    expect(score).toEqual({ score: 0, confidence: 0, reasoning: "" });
  });
});
