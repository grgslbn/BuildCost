import { describe, it, expect } from "vitest";
import { extractSqmViaVision, aggregateVisionSqm, type VisionSqmResult } from "../vision-extract";

const fakeVision = (payload: Record<string, unknown> | null) => async () => payload;

describe("extractSqmViaVision — assembly + categorization", () => {
  it("uses the model's category totals when present (area_table, exact)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "area_table",
      building_type: "appartementsgebouw",
      rows: [
        { label: "Appartementen + circulatie", m2: 2009, cat: "cat1" },
        { label: "Garage", m2: 420, cat: "cat2" },
        { label: "Terras", m2: 160, cat: "cat3" },
      ],
      cat1_m2: 2009, cat2_m2: 420, cat3_m2: 160,
      stated_total_m2: 2589,
      confidence: 0.95,
    }));
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("area_table");
    expect(r!.areas).toEqual({ cat1: 2009, cat2: 420, cat3: 160 });
    expect(r!.statedTotal).toBe(2589);
    expect(r!.confidence).toBeCloseTo(0.95);
  });

  it("falls back to summing categorized rows when cat totals are missing", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      rows: [
        { label: "App 0.1", m2: 84, cat: "cat1" },
        { label: "App 0.2", m2: 92, cat: "cat1" },
        { label: "Terras 0.1", m2: 12, cat: "cat3" },
        { label: "Zonnepanelen", m2: 30, cat: "other" },
      ],
      confidence: 0.5,
    }));
    expect(r!.areas.cat1).toBe(176);
    expect(r!.areas.cat3).toBe(12);
    expect(r!.areas.cat2).toBe(0);
  });

  it("does NOT count terraces as living area (the Die Prince bug)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      rows: [
        { label: "terras 07A", m2: 80, cat: "cat3" },
        { label: "terras 07B", m2: 80, cat: "cat3" },
        { label: "App 7A", m2: 120, cat: "cat1" },
      ],
      confidence: 0.45,
    }));
    expect(r!.areas.cat1).toBe(120); // only the apartment, not the terraces
    expect(r!.areas.cat3).toBe(160);
  });

  it("classifies bare_plan with a low default confidence when none given", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "bare_plan",
      rows: [{ label: "measured gross", m2: 300, cat: "cat1" }],
    }));
    expect(r!.kind).toBe("bare_plan");
    expect(r!.confidence).toBeLessThanOrEqual(0.35);
    expect(r!.method).toMatch(/measured/i);
  });

  it("coerces unknown kind to bare_plan and unknown cat to other", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "guess",
      rows: [{ label: "weird", m2: 50, cat: "cat9" }],
      confidence: 0.2,
    }));
    expect(r!.kind).toBe("bare_plan");
    expect(r!.areas).toEqual({ cat1: 0, cat2: 0, cat3: 0 }); // the "cat9" row → other → excluded
  });

  it("net floor WITH circulation rows → ×1.12 (HOOST case: rooms incl. gang/traphal)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      cat1_basis: "net",
      rows: [
        { label: "leefruimte", m2: 600, cat: "cat1" },
        { label: "slaapkamer", m2: 300, cat: "cat1" },
        { label: "traphal", m2: 100, cat: "cat1" },
      ],
      cat1_m2: 1000, cat2_m2: 0, cat3_m2: 0,
      confidence: 0.55,
    }));
    expect(r!.areas.cat1).toBe(1120); // circulation captured → walls only ×1.12
  });

  it("unit-only NET (no circulation rows) → ×1.35 (the 23-499974 case)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      cat1_basis: "unit_net",
      cat1_m2: 1106,
      rows: [
        { label: "APP.0.1 Netto Vloeropp", m2: 67, cat: "cat1" },
        { label: "APP.0.2 Netto Vloeropp", m2: 106, cat: "cat1" },
      ],
      confidence: 0.6,
    }));
    expect(r!.cat1Basis).toBe("unit_net");
    expect(r!.areas.cat1).toBe(Math.round(1106 * 1.35)); // 1493 ≈ expert GT 1493
  });

  it("unit-only + explicit circulation estimate → (nets+circ)×1.12 (the Hendrik I Lei fix)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      cat1_basis: "unit_net",
      cat1_m2: 401, // printed unit nets per level
      circulation_m2: 30, // model counted 2 compact cores from the drawing
      n_cores: 2,
      rows: [{ label: "APP 1.1", m2: 105, cat: "cat1" }],
      confidence: 0.6,
    }));
    expect(r!.circulationM2).toBe(30);
    expect(r!.areas.cat1).toBe(Math.round((401 + 30) * 1.12)); // 483 — not 401×1.35=541
  });

  it("suspicious circulation estimate (≥50% of nets) → fall back to ×1.35", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan", cat1_basis: "unit_net",
      cat1_m2: 400, circulation_m2: 250, // implausible: 62% of nets
      rows: [{ label: "APP 1", m2: 400, cat: "cat1" }], confidence: 0.5,
    }));
    expect(r!.circulationM2).toBeUndefined();
    expect(r!.areas.cat1).toBe(Math.round(400 * 1.35));
  });

  it("circulation rows present → ×1.12, explicit estimate ignored", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan", cat1_basis: "net",
      cat1_m2: 1000, circulation_m2: 99, // should be ignored: rows already include traphal
      rows: [{ label: "leefruimte", m2: 900, cat: "cat1" }, { label: "traphal", m2: 100, cat: "cat1" }],
      confidence: 0.5,
    }));
    expect(r!.areas.cat1).toBe(1120); // 1000×1.12, no double-add
  });

  it("net-family basis but NO circulation rows → ×1.35 (deterministic, ignores flaky self-label)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      cat1_basis: "net", // model said 'net' but no circulation row present
      cat1_m2: 1000, rows: [{ label: "APP 1", m2: 100, cat: "cat1" }],
      confidence: 0.6,
    }));
    expect(r!.areas.cat1).toBe(1350); // row-check overrides → unit-only ×1.35
  });

  it("does NOT gross up for cat1_basis 'gross'", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan", cat1_basis: "gross",
      cat1_m2: 1000, rows: [{ label: "x", m2: 1000, cat: "cat1" }], confidence: 0.6,
    }));
    expect(r!.areas.cat1).toBe(1000);
  });

  it("does NOT gross up when cat1 is unit-level BO (already gross)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      cat1_basis: "unit_gross",
      rows: [{ label: "app 07A BO", m2: 1000, cat: "cat1" }],
      cat1_m2: 1000, confidence: 0.55,
    }));
    expect(r!.cat1Basis).toBe("unit_gross");
    expect(r!.areas.cat1).toBe(1000);
  });

  it("applies a smaller factor for a mixed basis", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan", cat1_basis: "mixed",
      cat1_m2: 1000, rows: [{ label: "x", m2: 1000, cat: "cat1" }], confidence: 0.5,
    }));
    expect(r!.areas.cat1).toBe(1060); // ×1.06
  });

  it("NEVER grosses up an area_table (table values are already gross)", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "area_table", cat1_basis: "room_net", // even if mislabeled
      cat1_m2: 1000, rows: [{ label: "x", m2: 1000, cat: "cat1" }], confidence: 0.9,
    }));
    expect(r!.areas.cat1).toBe(1000);
  });

  it("does not gross up cat2/cat3, only cat1", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan", cat1_basis: "net",
      cat1_m2: 1000, cat2_m2: 500, cat3_m2: 200,
      rows: [{ label: "leefruimte", m2: 900, cat: "cat1" }, { label: "traphal", m2: 100, cat: "cat1" }],
      confidence: 0.5,
    }));
    expect(r!.areas.cat1).toBe(1120); // ×1.12 (circulation row present)
    expect(r!.areas.cat2).toBe(500); // unchanged
    expect(r!.areas.cat3).toBe(200); // unchanged
  });

  it("returns null on no images or null vision response", async () => {
    expect(await extractSqmViaVision([], fakeVision({ kind: "area_table" }))).toBeNull();
    expect(await extractSqmViaVision(["IMG"], fakeVision(null))).toBeNull();
  });

  it("aggregates labeled pages by SUMMING (multi-floor building, Die Prince case)", () => {
    const page = (cat1: number, cat3: number): VisionSqmResult => ({
      kind: "labeled_plan",
      areas: { cat1, cat2: 0, cat3 },
      statedTotal: null,
      confidence: 0.6,
      method: "x",
      cat1Basis: "unit_gross",
      cat1GrossFactor: 1.0,
      rows: [],
      raw: {},
    });
    const agg = aggregateVisionSqm([page(400, 87), page(439, 44), page(439, 44), null]);
    expect(agg!.kind).toBe("labeled_plan");
    expect(agg!.areas.cat1).toBe(1278);
    expect(agg!.areas.cat3).toBe(175);
    expect(agg!.confidence).toBeLessThanOrEqual(0.6);
  });

  it("dedups DUPLICATE floor sheets by floor label (the 23-499974 NL/FR-double case)", () => {
    const sheet = (floorLabel: string, cat1: number): VisionSqmResult => ({
      kind: "labeled_plan", areas: { cat1, cat2: 0, cat3: 0 }, statedTotal: null,
      confidence: 0.6, method: "x", cat1Basis: "net", cat1GrossFactor: 1.12, floorLabel, rows: [], raw: {},
    });
    // 6 sheets = 3 unique floors each bound twice (e.g. NL + FR)
    const agg = aggregateVisionSqm([
      sheet("Gelijkvloers / Rez-de-Chaussée", 233),
      sheet("1ste Verdieping - 1ier Étage", 308),
      sheet("2de Verdieping - 2ième Étage", 258),
      sheet("Gelijkvloers / Rez-de-Chaussée", 233),
      sheet("1ste Verdieping - 1ier Étage", 308),
      sheet("2de Verdieping - 2ième Étage", 258),
    ]);
    expect(agg!.areas.cat1).toBe(233 + 308 + 258); // 799, NOT doubled to 1598
  });

  it("does NOT merge distinct blocks that share a floor name (Gelijkvloers A vs B)", () => {
    const sheet = (floorLabel: string, cat1: number): VisionSqmResult => ({
      kind: "labeled_plan", areas: { cat1, cat2: 0, cat3: 0 }, statedTotal: null,
      confidence: 0.6, method: "x", cat1Basis: "gross", cat1GrossFactor: 1.0, floorLabel, rows: [], raw: {},
    });
    const agg = aggregateVisionSqm([sheet("Gelijkvloers A", 200), sheet("Gelijkvloers B", 300)]);
    expect(agg!.areas.cat1).toBe(500); // both kept (block letter survives normalisation)
  });

  it("a printed area table on any page wins outright (no summing of labeled pages)", () => {
    const table: VisionSqmResult = {
      kind: "area_table", areas: { cat1: 2009, cat2: 264, cat3: 459 }, statedTotal: 2732,
      confidence: 0.92, method: "x", cat1Basis: "unit_gross", cat1GrossFactor: 1.0, rows: [], raw: {},
    };
    const labeled: VisionSqmResult = {
      kind: "labeled_plan", areas: { cat1: 800, cat2: 0, cat3: 0 }, statedTotal: null,
      confidence: 0.5, method: "x", cat1Basis: "unit_gross", cat1GrossFactor: 1.0, rows: [], raw: {},
    };
    const agg = aggregateVisionSqm([labeled, table, labeled]);
    expect(agg!.kind).toBe("area_table");
    expect(agg!.areas.cat1).toBe(2009); // table is authoritative, not 800+800+2009
  });

  it("returns null when all pages are null/empty", () => {
    expect(aggregateVisionSqm([null, null])).toBeNull();
    expect(aggregateVisionSqm([])).toBeNull();
  });

  it("ignores negative/garbage m² values", async () => {
    const r = await extractSqmViaVision(["IMG"], fakeVision({
      kind: "labeled_plan",
      rows: [
        { label: "App 1", m2: 100, cat: "cat1" },
        { label: "App 2", m2: -50, cat: "cat1" },
        { label: "App 3", m2: "abc", cat: "cat1" },
      ],
      confidence: 0.5,
    }));
    expect(r!.areas.cat1).toBe(100);
  });
});
