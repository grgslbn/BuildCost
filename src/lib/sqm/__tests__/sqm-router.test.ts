import { describe, it, expect } from "vitest";
import {
  classifyAreaRow,
  detectSqmSource,
  parseAreaTableFromText,
} from "../sqm-router";
import { extractAreaTableViaVision, findAreaTablePages } from "../extract-area-table";

describe("classifyAreaRow (inclusive heated-floor classifier)", () => {
  it("routes outdoor built area to cat3", () => {
    expect(classifyAreaRow("Terras niveau 1")).toBe("cat3");
    expect(classifyAreaRow("Dakterras")).toBe("cat3");
    expect(classifyAreaRow("Balkon zuid")).toBe("cat3");
    expect(classifyAreaRow("Groendak")).toBe("cat3");
  });

  it("routes unheated enclosed area to cat2", () => {
    expect(classifyAreaRow("Kelder / garage")).toBe("cat2");
    expect(classifyAreaRow("Ondergrondse parking")).toBe("cat2");
    expect(classifyAreaRow("Berging fietsen")).toBe("cat2");
    expect(classifyAreaRow("Technische ruimte")).toBe("cat2");
  });

  it("routes non-floor add-ons to other (no real m²)", () => {
    expect(classifyAreaRow("Zonnepanelen")).toBe("other");
    expect(classifyAreaRow("Buitenaanleg")).toBe("other");
    expect(classifyAreaRow("Vetustiteit")).toBe("other");
    expect(classifyAreaRow("")).toBe("other");
  });

  it("defaults every remaining area row to heated cat1 (apartments, commercial, circulation)", () => {
    expect(classifyAreaRow("Appartementen + circulatie")).toBe("cat1");
    expect(classifyAreaRow("Woongedeelte niveau 2")).toBe("cat1");
    expect(classifyAreaRow("Handelsgelijkvloers")).toBe("cat1");
    expect(classifyAreaRow("Kantoren")).toBe("cat1");
  });
});

describe("detectSqmSource", () => {
  it("detects an area table from its markers + row cluster", () => {
    const text = `Berekening nieuwbouwwaarde
Omschrijving            Oppervlakte incl. btw
Appartementen + circulatie   1.250 m²        2.500.000,00
Garage / kelder              420 m²            378.000,00
Terras                       85 m²              42.500,00
Totaal kapitaal in nieuwbouwwaarde : 2.920.500,00`;
    const r = detectSqmSource(text);
    expect(r.source).toBe("area_table");
  });

  it("falls back to net_labels when per-unit BO labels are present", () => {
    const text = "Appartement 1.2  Opp: 84,5 m²\nAppartement 1.3  Opp: 92,0 m²";
    expect(detectSqmSource(text).source).toBe("net_labels");
  });

  it("falls back to plan_vision for a bare drawing", () => {
    const text = "Inplantingsplan schaal 1/100 — gevelzicht noord";
    expect(detectSqmSource(text).source).toBe("plan_vision");
  });
});

describe("findAreaTablePages", () => {
  it("returns the 1-indexed page(s) carrying the total / header marker", () => {
    const text = ["cover page", "plan page", "Totaal kapitaal in nieuwbouwwaarde : 1.000.000,00"].join("\f");
    expect(findAreaTablePages(text)).toEqual([3]);
  });
});

describe("extractAreaTableViaVision (route A aggregation)", () => {
  const pdfText = ["plan", "Totaal kapitaal in nieuwbouwwaarde : 3.000.000"].join("\f");
  const renderPages = async () => ["FAKE_BASE64_PNG"];

  it("aggregates vision rows into cat1/cat2/cat3 with the inclusive classifier", async () => {
    const visionJson = async () => ({
      building_type: "appartementsgebouw",
      rows: [
        { omschrijving: "Appartementen + circulatie", opp_m2: 1250, waarde_eur: 2_500_000 },
        { omschrijving: "Garage / kelder", opp_m2: 420, waarde_eur: 378_000 },
        { omschrijving: "Terras", opp_m2: 85, waarde_eur: 42_500 },
        { omschrijving: "Zonnepanelen", opp_m2: null, waarde_eur: 30_000 },
      ],
      total_eur: 2_950_500,
    });
    const r = await extractAreaTableViaVision(pdfText, renderPages, visionJson);
    expect(r.found).toBe(true);
    expect(r.areas.cat1).toBe(1250);
    expect(r.areas.cat2).toBe(420);
    expect(r.areas.cat3).toBe(85);
    expect(r.totalValue).toBe(2_950_500);
  });

  it("returns found=false when no table page is present", async () => {
    const r = await extractAreaTableViaVision("just a plan", renderPages, async () => ({ rows: [] }));
    expect(r.found).toBe(false);
  });

  it("returns found=false when vision returns no usable rows", async () => {
    const r = await extractAreaTableViaVision(pdfText, renderPages, async () => null);
    expect(r.found).toBe(false);
  });
});

describe("parseAreaTableFromText (text fallback presence check)", () => {
  it("does not crash on empty input", () => {
    expect(parseAreaTableFromText("").found).toBe(false);
  });
});
