import { describe, it, expect } from "vitest";
import { verifyChainReport, type ChainReport } from "../chain-reader";

const base = (over: Partial<ChainReport> = {}): ChainReport => ({
  floors: [],
  cat1_m2: 0,
  cat2_m2: 0,
  cat3_m2: 0,
  floor_count_from_sections: -1,
  flags: [],
  confidence: 0.8,
  ...over,
});

describe("verifyChainReport", () => {
  it("passes when chains close on printed end measures and sums match", () => {
    const report = base({
      floors: [
        {
          label: "gelijkvloers",
          page: 4,
          cat: "cat1",
          method: "dimension_chains",
          width_chain: [1.3, 5, 1.2, 5, 1.2, 5, 1.3],
          width_total: 20,
          depth_chain: [4, 4, 5],
          depth_total: 13,
          shape: [{ w_m: 20, d_m: 13, sign: 1 }],
          area_m2: 260,
        },
      ],
      cat1_m2: 260,
    });
    expect(verifyChainReport(report)).toEqual([]);
  });

  it("flags a chain whose segments do not sum to the printed end measure", () => {
    const report = base({
      floors: [
        {
          label: "kelder -1",
          page: 2,
          cat: "cat2",
          method: "dimension_chains",
          width_chain: [5, 5, 4.4],
          width_total: 20, // som 14.4 ≠ 20
          area_m2: 260,
        },
      ],
      cat2_m2: 260,
    });
    const problems = verifyChainReport(report);
    expect(problems.some((p) => p.includes("keten som"))).toBe(true);
  });

  it("flags a shape decomposition that disagrees with the reported area", () => {
    const report = base({
      floors: [
        {
          label: "verdieping +2",
          page: 6,
          cat: "cat1",
          method: "dimension_chains",
          shape: [{ w_m: 20, d_m: 13, sign: 1 }], // 260
          area_m2: 340,
        },
      ],
      cat1_m2: 340,
    });
    const problems = verifyChainReport(report);
    expect(problems.some((p) => p.includes("shape-som"))).toBe(true);
  });

  it("flags category totals that disagree with the per-floor sums (incl. mixed splits)", () => {
    const report = base({
      floors: [
        {
          label: "gelijkvloers",
          page: 3,
          cat: "mixed",
          method: "dimension_chains",
          area_m2: 200,
          cat_split: { cat1: 170, cat2: 30 },
        },
        { label: "verdieping +1", page: 5, cat: "cat1", method: "dimension_chains", area_m2: 100 },
      ],
      cat1_m2: 400, // werkelijke som cat1 = 270
      cat2_m2: 30,
    });
    const problems = verifyChainReport(report);
    expect(problems.some((p) => p.startsWith("cat1"))).toBe(true);
    // cat2 klopt wél
    expect(problems.some((p) => p.startsWith("cat2"))).toBe(false);
  });

  it("excluded floors count nowhere", () => {
    const report = base({
      floors: [
        { label: "carport", page: 3, cat: "excluded", method: "printed_label", area_m2: 18 },
        { label: "gelijkvloers", page: 3, cat: "cat1", method: "dimension_chains", area_m2: 180 },
      ],
      cat1_m2: 180,
    });
    expect(verifyChainReport(report)).toEqual([]);
  });
});
