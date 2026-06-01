/**
 * SQM source router.
 *
 * Benchmark (2026-05-31) proved vision MEASUREMENT of bare raster plans is
 * unreliable (~38% even at high confidence). But many dossiers contain a
 * STRUCTURED area table (architect oppervlaktestaat / meetstaat / unit schedule,
 * or a provided berekening) whose m² values are EXACT and text-extractable.
 *
 * The router inspects the PDF text and picks the most reliable available source:
 *   1. AREA_TABLE  — a structured table of areas → parse deterministically (<10%).
 *   2. NET_LABELS  — per-unit Opp/BO labels on the plan → sum × gross factor (~±15%).
 *   3. PLAN_VISION — bare line drawing → vision measurement + confidence-gating (~±38%, flagged).
 *
 * Only AREA_TABLE reaches the <10% the project needs; the router surfaces which
 * source was used so the UI/confidence reflects it honestly.
 */

export type SqmSource = "area_table" | "net_labels" | "plan_vision";

export type CategoryAreas = { cat1: number; cat2: number; cat3: number };

export type AreaTableResult = {
  found: boolean;
  areas: CategoryAreas;
  rows: Array<{ desc: string; opp: number; value: number | null; cat: keyof CategoryAreas | "other" }>;
  totalValue: number | null;
};

const numNL = (s: string) =>
  parseFloat(String(s).replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));

/**
 * Inclusive heated-floor classifier (gross floor the building actually contains).
 * cat3 = outdoor, cat2 = unheated enclosed (kelder/garage/storage/technical).
 * Everything else with an area = heated finished floor (cat1) — apartments,
 * commercial, offices, circulation/common. This default-to-heated rule matches the
 * expert "appartementen + circulatie" basis and is validated against the GT.
 */
export function classifyAreaRow(desc: string): keyof CategoryAreas | "other" {
  const d = (desc || "").toLowerCase();
  if (!d.trim()) return "other";
  if (/terras|balkon|dakterras|dakterrassen|groendak|gras\b/.test(d)) return "cat3";
  if (/kelder|garage|berging|parking|staanplaats|fietsberg|afvalberg|techni|inrit|hellingsbaan|liften?\b|sprinkler|vuilnis|afval|stalling|loods/.test(d)) return "cat2";
  // rows that are clearly non-floor add-ons (no real m²) → other
  if (/zonnepane|lift(installatie)?|buitenaanleg|vetuste?it|energieprestatie|fotovolta|pv\b|warmtepomp|domotica/.test(d)) return "other";
  // default: any remaining area row is heated finished floor
  return "cat1";
}

/**
 * Parse a structured area table from PDF text. Looks for the table window ending
 * at a total marker ("Totaal kapitaal", "NIEUWBOUWWAARDE", "Totaal oppervlakte"),
 * then extracts (description, area m², optional value) rows. Returns found=false if
 * no recognizable table is present (→ caller falls back to net labels / vision).
 */
export function parseAreaTableFromText(text: string): AreaTableResult {
  const empty: AreaTableResult = { found: false, areas: { cat1: 0, cat2: 0, cat3: 0 }, rows: [], totalValue: null };
  if (!text) return empty;
  const lines = text.split(/\r?\n/);

  // locate a total / table-end marker; the table sits in the ~70 lines above it
  let endIdx = lines.findIndex((l) =>
    /Totaal kapitaal in nieuwbouwwaarde|NIEUWBOUWWAARDE\s+INCLUSIEF|Totaal\s+oppervlakte|Totale?\s+(bruto|woon)?oppervlakte/i.test(l),
  );
  if (endIdx < 0) {
    // also accept an explicit area-schedule header
    const hdr = lines.findIndex((l) => /oppervlaktestaat|oppervlaktetabel|meetstaat|opp\/inhoud|oppervlakte\s+(incl|m)/i.test(l));
    if (hdr < 0) return empty;
    endIdx = Math.min(lines.length, hdr + 70);
  }
  const start = Math.max(0, endIdx - 70);
  const window = lines.slice(start, endIdx);

  const areas: CategoryAreas = { cat1: 0, cat2: 0, cat3: 0 };
  const rows: AreaTableResult["rows"] = [];
  for (const ln of window) {
    // area marker: "<num> m²" (pdftotext renders ² as a replacement char sometimes)
    const am = ln.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m(?=[\s²2�])/);
    if (!am) continue;
    const opp = numNL(am[1]);
    if (!(opp >= 2 && opp <= 8000)) continue;
    const after = ln.slice(ln.indexOf(am[0]) + am[0].length);
    const vm = Array.from(after.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{4,}(?:,\d{2})?)/g)).map((x) => numNL(x[1])).filter((v) => v >= 1000);
    const value = vm.length ? vm[0] : null;
    const desc = ln.replace(/\s{2,}/g, " ").trim().slice(0, 60);
    const cat = classifyAreaRow(desc);
    if (cat !== "other") areas[cat] += opp;
    rows.push({ desc, opp, value, cat });
  }
  // require at least 2 categorized rows with a meaningful cat1 to consider it a real table
  const found = rows.filter((r) => r.cat !== "other").length >= 2 && areas.cat1 >= 20;
  const tm = text.match(/(?:Totaal kapitaal in nieuwbouwwaarde|NIEUWBOUWWAARDE\s+INCLUSIEF BTW)\s*:?\s*([\d.]+,?\d{0,2})/i);
  return { found, areas, rows, totalValue: tm ? numNL(tm[1]) : null };
}

/**
 * Detect whether a structured AREA TABLE is present (reliable, marker-based).
 * NOTE: pdftotext frequently MIS-ALIGNS the columns of these tables (areas land on
 * the wrong row), so the text PARSE of the values is unreliable — but the PRESENCE
 * of a table is reliably detectable from its headers + total + a cluster of
 * "<area> m² … <value>" rows. When present, EXTRACTION must be done with vision
 * (proven exact in bench-experts-vision), not the text parser.
 */
export function hasAreaTableMarkers(text: string): boolean {
  if (!text) return false;
  const hasHeader =
    /Oppervlakte\s+incl\.?\s*btw/i.test(text) ||
    /Opp\/inhoud/i.test(text) ||
    /Omschrijving[\s\S]{0,40}(Niveau|Oppervlakte)/i.test(text);
  const hasTotal = /Totaal kapitaal in nieuwbouwwaarde|NIEUWBOUWWAARDE\s+INCLUSIEF BTW/i.test(text);
  // a cluster of "<area> m² … <value>" rows near the total. Belgian formatting:
  // areas may carry a thousand-dot + comma-decimal (1.250 m²), values use
  // thousand separators (2.500.000,00) or a bare 4+ digit run.
  const rowHits = (
    text.match(
      /\d{1,4}(?:\.\d{3})?(?:,\d{1,2})?\s*m[²2�][^\n]{0,40}(?:\d{1,3}(?:\.\d{3})+|\d{4,})/gi,
    ) || []
  ).length;
  return (hasHeader || hasTotal) && rowHits >= 3;
}

/**
 * Decide which SQM source to use, given the dossier's extracted PDF text.
 *  - area_table : a structured table is present → extract with VISION (exact, <10%).
 *  - net_labels : per-unit Opp/BO labels on the plan → sum × factor (~±15%).
 *  - plan_vision: bare drawing → vision measurement + confidence-gating (~±38%, flagged).
 * `tableReliableViaText` is true only when the text parse looks internally consistent
 * (rare); otherwise the table is present but must be read by vision.
 */
export function detectSqmSource(text: string): {
  source: SqmSource;
  table?: AreaTableResult;
  tableReliableViaText: boolean;
} {
  if (hasAreaTableMarkers(text)) {
    const table = parseAreaTableFromText(text);
    // text parse is "reliable" only if it found a healthy cat1 with units present;
    // pdftotext column-misalignment usually breaks this → extraction falls to vision.
    const reliable = table.found && table.areas.cat1 >= 150 && table.rows.filter((r) => r.cat === "cat1").length >= 2;
    return { source: "area_table", table, tableReliableViaText: reliable };
  }
  if (/\b(?:BVO|BO|Opp\.?)\s*:?\s*\d{2,3}[.,]\d/i.test(text || "")) return { source: "net_labels", tableReliableViaText: false };
  return { source: "plan_vision", tableReliableViaText: false };
}
