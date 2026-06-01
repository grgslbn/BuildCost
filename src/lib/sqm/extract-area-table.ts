/**
 * Route A — extract a structured area table from a dossier via VISION.
 *
 * Benchmark proved: when a dossier contains a structured area table (architect
 * oppervlaktestaat / meetstaat / berekening), reading it with VISION is EXACT
 * (bench-experts-vision reproduced every total). Reading it from pdftotext is NOT
 * reliable (column mis-alignment). So: locate the table page via a reliable text
 * marker, render it, and extract the rows with a vision model.
 *
 * The actual model call is injected (visionJson) so this module stays pure and
 * testable, and the pipeline supplies its existing Claude client.
 */
import type { CategoryAreas } from "./sqm-router";
import { classifyAreaRow } from "./sqm-router";

export type AreaTableRow = {
  omschrijving: string;
  opp_m2: number | null;
  waarde_eur: number | null;
  niveau?: string | null;
  cat?: "cat1" | "cat2" | "cat3" | "other" | null;
};
export type AreaTableExtraction = {
  found: boolean;
  areas: CategoryAreas;
  totalValue: number | null;
  buildingType?: string;
  rows: AreaTableRow[];
};

/** A function that sends {systemPrompt, userText, imagesB64} to a vision model and returns parsed JSON. */
export type VisionJsonFn = (args: {
  system: string;
  text: string;
  imagesB64: string[];
}) => Promise<Record<string, unknown> | null>;

/** A function that renders 1-indexed PDF pages to base64 PNGs (≤ ~3.8 MB each). */
export type RenderPagesFn = (pageNumbers1Indexed: number[]) => Promise<string[]>;

export const AREA_TABLE_SYSTEM =
  "You extract data from a Belgian building reconstruction-cost / area table (Berekening / oppervlaktestaat / meetstaat). Read the table and return ONLY JSON.";

export const AREA_TABLE_INSTR = `Return JSON:
{"building_type":"appartementsgebouw|winkel|woning|...",
 "rows":[{"omschrijving":"...","niveau":"...","opp_m2":<number or null>,"waarde_eur":<number or null>,"cat":"cat1|cat2|cat3|other"}],
 "total_eur":<number or null>}
opp_m2 = the Oppervlakte/Opp value in m² (null if the row has no area, e.g. lift/zonnepanelen/buitenaanleg).
niveau = the level/column shown for the row (e.g. "Parkeerkelder", "Nivo 1", "GVL") — IMPORTANT for categorising.
cat = the category, using BOTH the description AND the niveau:
  • cat1 = HEATED living/finished floor: apartments, houses, offices, shops/commercial, common circulation (gemene delen, circulatie, traphal, inkomhal). "Appartementen + circulatie" → cat1.
  • cat2 = ENCLOSED UNHEATED: garage, parking, PARKEERKELDER, kelder, berging, technical, hellingsbaan/inrit. A row whose NIVEAU is "Parkeerkelder"/"Kelder" → cat2 even if its description is generic like "Onder het gebouw"/"Binnen de gebouwen".
  • cat3 = OUTDOOR BUILT: terras, balkon, dakterras, terrassen.
  • other = NOT floor area: lift, zonnepanelen, buitenaanleg, vetustiteit, onroerende inrichting.
waarde_eur = the € value if shown. Numbers in Belgian format (1.657,60 → 1657.60). Include EVERY table row. Do not invent rows.`;

/**
 * Find the 1-indexed pages that contain the area table, using reliable text markers
 * (the total line + table header). Returns [] if none found.
 */
export function findAreaTablePages(pdfText: string): number[] {
  const pages = pdfText.split("\f");
  const idx: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (
      /Totaal kapitaal in nieuwbouwwaarde|NIEUWBOUWWAARDE\s+INCLUSIEF|Oppervlakte\s+incl\.?\s*btw|Opp\/inhoud|oppervlaktestaat|meetstaat/i.test(
        pages[i],
      )
    )
      idx.push(i + 1);
  }
  return Array.from(new Set(idx));
}

/** Extract the area table via vision and aggregate into cat1/cat2/cat3. */
export async function extractAreaTableViaVision(
  pdfText: string,
  renderPages: RenderPagesFn,
  visionJson: VisionJsonFn,
): Promise<AreaTableExtraction> {
  const empty: AreaTableExtraction = { found: false, areas: { cat1: 0, cat2: 0, cat3: 0 }, totalValue: null, rows: [] };
  const pages = findAreaTablePages(pdfText);
  if (!pages.length) return empty;

  // Render up to 6 marker pages: backtest showed the under-reads (−29%..−45%) were
  // multi-page tables where only the first pages were captured.
  const imagesB64 = await renderPages(pages.slice(0, 6));
  if (!imagesB64.length) return empty;

  const data = await visionJson({ system: AREA_TABLE_SYSTEM, text: AREA_TABLE_INSTR, imagesB64 });
  if (!data || !Array.isArray(data.rows)) return empty;

  const areas: CategoryAreas = { cat1: 0, cat2: 0, cat3: 0 };
  const rows: AreaTableRow[] = [];
  const VALID = ["cat1", "cat2", "cat3", "other"];
  for (const r of data.rows as AreaTableRow[]) {
    const opp = typeof r.opp_m2 === "number" ? r.opp_m2 : 0;
    if (opp <= 0) continue;
    // Prefer the model's per-row category (it sees the niveau column, so it puts a
    // "Parkeerkelder / Onder het gebouw" row in cat2 — the keyword-only classifier
    // would wrongly call it cat1). Fall back to classifyAreaRow on description+niveau.
    const modelCat = r.cat && VALID.includes(r.cat) ? r.cat : null;
    const cat = modelCat ?? classifyAreaRow(`${r.omschrijving ?? ""} ${r.niveau ?? ""}`);
    if (cat !== "other") areas[cat] += opp;
    rows.push(r);
  }
  const found = areas.cat1 >= 20 && rows.length >= 2;
  return {
    found,
    areas,
    totalValue: typeof data.total_eur === "number" ? data.total_eur : null,
    buildingType: typeof data.building_type === "string" ? data.building_type : undefined,
    rows,
  };
}
