import { describe, it, expect } from "vitest";
import {
  convertToScore,
  QQP_REFERENCE_RANGES,
  QQP_NAMES,
} from "../reference-ranges";

describe("QQP_REFERENCE_RANGES", () => {
  it("has exactly 32 QQP definitions", () => {
    expect(QQP_NAMES.length).toBe(32);
  });

  it("every entry has a promptGuide", () => {
    for (const name of QQP_NAMES) {
      expect(QQP_REFERENCE_RANGES[name].promptGuide).toBeTruthy();
    }
  });

  it("numeric/ratio/score entries have referencePoints", () => {
    for (const name of QQP_NAMES) {
      const range = QQP_REFERENCE_RANGES[name];
      if (range.dataType !== "boolean") {
        expect(range.referencePoints).toBeDefined();
        expect(range.referencePoints!.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("boolean entries have booleanScores", () => {
    for (const name of QQP_NAMES) {
      const range = QQP_REFERENCE_RANGES[name];
      if (range.dataType === "boolean") {
        expect(range.booleanScores).toBeDefined();
      }
    }
  });
});

describe("convertToScore", () => {
  it("boolean true → positive score", () => {
    expect(convertToScore("has_dressing", true)).toBe(0.5);
  });

  it("boolean false → 0", () => {
    expect(convertToScore("has_dressing", false)).toBe(0.0);
  });

  it("has_wellness true → 0.8 (high luxury signal)", () => {
    expect(convertToScore("has_wellness", true)).toBe(0.8);
  });

  it("numeric at midpoint → 0", () => {
    // kitchen_sqm midpoint is 10m² = 0.0
    expect(convertToScore("kitchen_sqm", 10)).toBeCloseTo(0.0, 1);
  });

  it("numeric below range → clamp to min score", () => {
    // kitchen_sqm: 5m² = -1.0, so 3m² should clamp to -1.0
    expect(convertToScore("kitchen_sqm", 3)).toBe(-1.0);
  });

  it("numeric above range → clamp to max score", () => {
    // kitchen_sqm: 20m² = +1.0, so 25m² should clamp to +1.0
    expect(convertToScore("kitchen_sqm", 25)).toBe(1.0);
  });

  it("numeric interpolates between reference points", () => {
    // kitchen_sqm: 8m²=-0.5, 10m²=0.0 → 9m² should be -0.25
    const score = convertToScore("kitchen_sqm", 9);
    expect(score).toBeCloseTo(-0.25, 1);
  });

  it("null value → 0 (neutral)", () => {
    expect(convertToScore("kitchen_sqm", null)).toBe(0);
  });

  it("unknown QQP name → 0 (neutral)", () => {
    expect(convertToScore("nonexistent_qqp", 42)).toBe(0);
  });

  it("ratio QQP interpolates correctly", () => {
    // circulation_ratio: 0.15 = 0.0
    expect(convertToScore("circulation_ratio", 0.15)).toBeCloseTo(0.0, 1);
  });

  it("all scores stay within [-1, +1] range", () => {
    for (const name of QQP_NAMES) {
      const range = QQP_REFERENCE_RANGES[name];
      if (range.referencePoints) {
        for (const pt of range.referencePoints) {
          expect(pt.score).toBeGreaterThanOrEqual(-1.0);
          expect(pt.score).toBeLessThanOrEqual(1.0);
        }
      }
      if (range.booleanScores) {
        expect(range.booleanScores.whenTrue).toBeGreaterThanOrEqual(-1.0);
        expect(range.booleanScores.whenTrue).toBeLessThanOrEqual(1.0);
        expect(range.booleanScores.whenFalse).toBeGreaterThanOrEqual(-1.0);
        expect(range.booleanScores.whenFalse).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
