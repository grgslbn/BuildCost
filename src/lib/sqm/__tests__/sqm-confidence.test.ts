import { describe, it, expect } from "vitest";
import { computeSqmConfidence } from "../sqm-confidence";

describe("computeSqmConfidence", () => {
  it("clean apartment building → high confidence", () => {
    // Die Prince-like: cat1 1876, net units ~1450, 16 units, 10 levels
    const r = computeSqmConfidence({
      cat1Sqm: 1876, cat2Sqm: 444, cat3Sqm: 271,
      netUnitSqmSum: 1450, unitCount: 16, levelCount: 10,
    });
    expect(r.level).toBe("high");
    expect(r.needsManualReview).toBe(false);
  });

  it("catastrophic under-measurement (73 m² building) → low, manual review", () => {
    const r = computeSqmConfidence({
      cat1Sqm: 73, cat2Sqm: 0, cat3Sqm: 0,
      netUnitSqmSum: 1044, unitCount: 10, levelCount: 4,
    });
    expect(r.level).toBe("low");
    expect(r.needsManualReview).toBe(true);
    expect(r.flags.length).toBeGreaterThan(0);
  });

  it("gross < net (physically impossible) → flagged", () => {
    const r = computeSqmConfidence({
      cat1Sqm: 1240, cat2Sqm: 0, cat3Sqm: 0, netUnitSqmSum: 1643,
    });
    expect(r.flags.some((f) => /bruto<netto|onmogelijk/i.test(f))).toBe(true);
    expect(r.score).toBeLessThan(0.75);
  });

  it("tall building with tiny per-level area → floors missed flag", () => {
    const r = computeSqmConfidence({
      cat1Sqm: 200, cat2Sqm: 0, cat3Sqm: 0, levelCount: 9,
    });
    expect(r.needsManualReview).toBe(true);
    expect(r.flags.some((f) => /verdieping/i.test(f))).toBe(true);
  });

  it("plausible mid-size with no aux signals → high (only absolute check)", () => {
    const r = computeSqmConfidence({ cat1Sqm: 900, cat2Sqm: 300, cat3Sqm: 80 });
    expect(r.level).toBe("high");
  });

  it("stated-total cross-check: big shortfall → under-capture flag + downgrade", () => {
    // captured 1200 vs stated 2400 = 50% → incomplete capture
    const r = computeSqmConfidence({
      cat1Sqm: 1100, cat2Sqm: 100, cat3Sqm: 0, statedTotalSqm: 2400,
    });
    expect(r.flags.some((f) => /capture onvolledig|onvolledig/i.test(f))).toBe(true);
    expect(r.score).toBeLessThan(0.75);
  });

  it("stated-total cross-check: captured matches stated total → no penalty", () => {
    const r = computeSqmConfidence({
      cat1Sqm: 1600, cat2Sqm: 300, cat3Sqm: 100, statedTotalSqm: 2000,
    });
    expect(r.flags.some((f) => /totaal/i.test(f))).toBe(false);
    expect(r.level).toBe("high");
  });

  it("stated-total cross-check: large over-capture → double-count flag", () => {
    const r = computeSqmConfidence({
      cat1Sqm: 2800, cat2Sqm: 200, cat3Sqm: 0, statedTotalSqm: 2000,
    });
    expect(r.flags.some((f) => /dubbeltelling|boven vermeld/i.test(f))).toBe(true);
  });

  it("no stated total → cross-check is a no-op", () => {
    const a = computeSqmConfidence({ cat1Sqm: 1600, cat2Sqm: 0, cat3Sqm: 0 });
    const b = computeSqmConfidence({ cat1Sqm: 1600, cat2Sqm: 0, cat3Sqm: 0, statedTotalSqm: null });
    expect(a.score).toBe(b.score);
  });
});
