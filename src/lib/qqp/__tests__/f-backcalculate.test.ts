import { describe, it, expect } from "vitest";
import { backcalculateF } from "../f-backcalculate";

describe("backcalculateF", () => {
  const pricing = {
    cat1_min: 1100,
    cat1_max: 1900,
    cat2_min: 550,
    cat2_max: 950,
    cat3_min: 330,
    cat3_max: 570,
  };

  it("midpoint pricing returns F≈1.10", () => {
    const areas = { cat1_sqm: 150, cat2_sqm: 50, cat3_sqm: 20 };
    const cat1Price = 1100 + ((1.1 - 0.7) / 0.8) * 800; // 1500
    const cat2Price = 550 + ((1.1 - 0.7) / 0.8) * 400; // 750
    const cat3Price = 330 + ((1.1 - 0.7) / 0.8) * 240; // 450
    const totalCost =
      (150 * cat1Price + 50 * cat2Price + 20 * cat3Price) * 1.0 * 1.0;
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.f).toBeCloseTo(1.1, 2);
    expect(result.isOutlier).toBe(false);
  });

  it("very cheap building → F at minimum (0.70)", () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const totalCost = 100 * 1100 * 1.0 * 1.0; // exactly at cat1_min
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.f).toBeCloseTo(0.7, 2);
  });

  it("outlier flagged when F > 1.50", () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const totalCost = 100 * 2200 * 1.0 * 1.0; // beyond cat1_max
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.isOutlier).toBe(true);
    expect(result.f).toBe(1.5); // clamped
  });

  it("outlier flagged when F < 0.70", () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const totalCost = 100 * 500 * 1.0 * 1.0; // way below cat1_min
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.isOutlier).toBe(true);
    expect(result.f).toBe(0.7); // clamped
  });

  it("regional and ABEX factors applied correctly", () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const f = 1.1;
    const cat1Price = 1100 + ((f - 0.7) / 0.8) * 800;
    const totalCost = 100 * cat1Price * 1.05 * 0.95;
    const result = backcalculateF(totalCost, areas, pricing, 1.05, 0.95);
    expect(result.f).toBeCloseTo(f, 2);
  });

  it("rawF is returned before clamping", () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const totalCost = 100 * 2200; // beyond max
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.rawF).toBeGreaterThan(1.5);
    expect(result.f).toBe(1.5);
  });
});
