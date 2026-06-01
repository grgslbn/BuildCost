/**
 * Universal vision SQM extractor.
 *
 * Works on ANY rendered images — a JPEG upload, or PDF pages rendered to PNG. It
 * unifies detection + extraction in one vision pass and is honest about which signal
 * it used:
 *
 *   1. AREA_TABLE   — the images contain a berekening / oppervlaktestaat / meetstaat
 *                     (a table of areas). Vision transcribes it → EXACT (validated
 *                     median 0% vs heated-floor GT). Text-detection (pdftotext/mupdf)
 *                     misses most of these (non-extractable fonts), but VISION reads
 *                     them reliably — this is why we detect with vision, not text.
 *   2. LABELED_PLAN — no table, but units/rooms carry printed m² labels → sum them.
 *                     Medium confidence (capture completeness varies).
 *   3. BARE_PLAN    — only dimension lines / no printed areas → measured estimate.
 *                     LOW confidence — vision measurement is unreliable (~38%), so
 *                     this is flagged for manual review / manual m² entry.
 *
 * The model does the cat1/cat2/cat3 categorization with explicit rules (cleaner than
 * post-hoc string matching on free-text labels), and self-reports a confidence we
 * gate further downstream.
 */
import type { CategoryAreas } from "./sqm-router";

export type SqmKind = "area_table" | "labeled_plan" | "bare_plan";

/**
 * Whether the cat1 figure is a unit-level GROSS area (BO/bruto/Opp — already includes
 * walls) or a sum of room-level NET areas (NO/netto leefruimte/slaapkamer — excludes
 * interior walls). Net room sums undercount the gross heated floor by ~10-15%, so they
 * get a net→gross factor. Validated: HOOST 547563 room-sum 14902 → ×1.12 ≈ GT 16783.
 */
export type Cat1Basis =
  | "gross" // BRUTO / BO — includes interior walls (no factor)
  | "net" // NETTO / NO / "netto vloeropp" — excludes walls (×1.12), whether per-unit or per-room
  | "mixed"
  | "unit_gross" // legacy alias for gross
  | "room_net" // legacy alias for net
  | "unknown";

/** Bases that mean the cat1 figure is NET (excludes interior walls) → needs gross-up. */
const NET_BASES = new Set(["net", "room_net"]);

/** Net→gross multipliers applied to a room-NET cat1 (interior walls + structure). */
export const NET_TO_GROSS = 1.12;
export const NET_TO_GROSS_MIXED = 1.06;

export type VisionSqmResult = {
  kind: SqmKind;
  areas: CategoryAreas; // cat1 (heated/living), cat2 (enclosed unheated), cat3 (outdoor built)
  statedTotal: number | null;
  confidence: number; // 0..1, model self-assessment (gated downstream)
  method: string; // short human-readable description
  buildingType?: string;
  cat1Basis: Cat1Basis; // basis of the cat1 figure (drives the net→gross factor)
  cat1GrossFactor: number; // factor applied to raw cat1 (1.0 if none)
  floorLabel?: string; // which floor this sheet is (used to dedup duplicate sheets)
  rows: Array<{ label: string; m2: number; cat: keyof CategoryAreas | "other" }>;
  raw: Record<string, unknown>;
};

/** Inject the project's Claude client. Returns parsed JSON or null. */
export type VisionJsonFn = (args: {
  system: string;
  text: string;
  imagesB64: string[];
}) => Promise<Record<string, unknown> | null>;

export const VISION_SQM_SYSTEM =
  "You extract building floor areas (m²) from Belgian building documents — architect floor plans, JPEG photos of plans, or reconstruction-cost tables (berekening / oppervlaktestaat / meetstaat). You PREFER printed numbers over measuring. You categorize every area and you are honest about uncertainty. Return ONLY JSON.";

export const VISION_SQM_INSTR = `Look at ALL the images (one building project). They may be full sheets OR overlapping CROPPED TILES of larger plan sheets — the same label can appear in two tiles, so count each distinct unit/room/row ONCE (dedup by label text). Determine the BEST available area signal and report it.

STEP 1 — Is there an AREA TABLE / berekening / oppervlaktestaat / meetstaat anywhere (a table listing descriptions + m² + often € values, or columns like "Opp", "Oppervlakte incl. btw", "Opp/inhoud", "BVO")?
  → If YES: set "kind":"area_table" and transcribe EVERY row into "rows".
STEP 2 — Else, do units/rooms carry PRINTED m² labels ("Opp.: 74,76 m²", "BO 104,3 m²", "Leefruimte 32 m²")?
  → If YES: set "kind":"labeled_plan" and list every labeled area in "rows" (count each ONCE across sheets).
STEP 3 — Else (only dimension lines / no printed areas):
  → set "kind":"bare_plan", measure the gross floor per level from dimensions, and put your best estimate in "rows" with low confidence.

CRITICAL — do NOT double-count. Belgian plans label a unit's gross area ("BO", "bruto", "Opp.") AND the individual rooms inside it ("NO", "netto": leefruimte, slaapkamer, badkamer…). Report the UNIT-level area ONCE per unit; do NOT also add its interior rooms. Rule: if a unit/apartment has a BO/Opp total, use that and SKIP its NO room labels. Only sum room labels when there is no unit total for that space. Each terras/balkon is its own cat3 row (not part of the unit's living area).

CATEGORIZE every row's "cat":
  - "cat1" = HEATED / LIVING / FINISHED floor: apartments, houses, studios, offices, shops/commercial, common circulation (gemene delen, traphal, inkomhal, lift lobby). This is the main number.
  - "cat2" = ENCLOSED UNHEATED: garage, parking, cellar (kelder), storage (berging), technical room, bicycle/waste storage.
  - "cat3" = OUTDOOR BUILT: terrace (terras), balcony (balkon), roof terrace, green roof.
  - "other" = NOT floor area: solar panels, lift installation, outdoor landscaping (buitenaanleg), vetustiteit — exclude from totals.

Belgian numbers: 1.234,56 → 1234.56. Count each area ONCE.

Return JSON:
{
 "kind": "area_table" | "labeled_plan" | "bare_plan",
 "building_type": "appartementsgebouw|woning|winkel|kantoor|...",
 "rows": [{"label":"...", "level":"...", "m2": <number>, "cat": "cat1|cat2|cat3|other"}],
 "floor_label": "<which floor/level this sheet shows, e.g. Gelijkvloers, +2, Kelder>",
 "cat1_m2": <number>, "cat2_m2": <number>, "cat3_m2": <number>,
 "cat1_basis": "gross" | "net" | "mixed",
 "stated_total_m2": <number or null>,
 "confidence": <0..1>,
 "notes": "which signal you used and any uncertainty"
}
cat1_basis tells whether the cat1 figure is GROSS or NET (drives a walls correction):
  • "gross" = BRUTO / BO areas ("app X BO 104 m²", "bruto") — already includes interior walls.
  • "net" = NETTO areas ("Netto Vloeropp.", "NO", room areas leefruimte/slaapkamer NETTO) — EXCLUDES walls. Use "net" for ANY netto figure, whether per-unit ("APP.0.1 Netto Vloeropp 67,3 m²") or per-room.
  • "mixed" = a mix of both.
confidence guide: area_table fully read ≥0.9; labeled_plan with complete labels ~0.6; partial labels ~0.4; bare_plan measured ≤0.35.`;

const ALLOWED: Array<keyof CategoryAreas | "other"> = ["cat1", "cat2", "cat3", "other"];

/**
 * Run the universal vision extraction over a set of base64 PNG/JPEG images.
 * Prefers the model's own cat totals; falls back to summing categorized rows.
 */
export async function extractSqmViaVision(
  imagesB64: string[],
  visionJson: VisionJsonFn,
): Promise<VisionSqmResult | null> {
  if (!imagesB64.length) return null;
  const data = await visionJson({
    system: VISION_SQM_SYSTEM,
    text: VISION_SQM_INSTR,
    imagesB64,
  });
  if (!data) return null;

  const kindRaw = String(data.kind ?? "bare_plan");
  const kind: SqmKind =
    kindRaw === "area_table" || kindRaw === "labeled_plan" ? (kindRaw as SqmKind) : "bare_plan";

  const rows = Array.isArray(data.rows)
    ? (data.rows as Array<Record<string, unknown>>).map((r) => {
        const catRaw = String(r.cat ?? "other") as keyof CategoryAreas | "other";
        const cat = ALLOWED.includes(catRaw) ? catRaw : "other";
        return { label: String(r.label ?? ""), m2: num(r.m2), cat };
      })
    : [];

  // Prefer the model's category totals; fall back to summing rows we categorized.
  const sumRows = (c: keyof CategoryAreas) =>
    rows.filter((r) => r.cat === c).reduce((s, r) => s + (r.m2 > 0 ? r.m2 : 0), 0);
  const areas: CategoryAreas = {
    cat1: pickNum(data.cat1_m2, sumRows("cat1")),
    cat2: pickNum(data.cat2_m2, sumRows("cat2")),
    cat3: pickNum(data.cat3_m2, sumRows("cat3")),
  };

  // Net→gross correction on cat1 ONLY for a labeled_plan whose cat1 came from room-level
  // NET areas (interior walls excluded). A table or unit-level BO figure is already gross.
  const basisRaw = String(data.cat1_basis ?? "");
  const VALID_BASIS = ["gross", "net", "mixed", "unit_gross", "room_net"];
  const cat1Basis: Cat1Basis = VALID_BASIS.includes(basisRaw) ? (basisRaw as Cat1Basis) : "unknown";
  let cat1GrossFactor = 1.0;
  if (kind === "labeled_plan") {
    if (NET_BASES.has(cat1Basis)) cat1GrossFactor = NET_TO_GROSS;
    else if (cat1Basis === "mixed") cat1GrossFactor = NET_TO_GROSS_MIXED;
  }
  if (cat1GrossFactor !== 1.0) areas.cat1 = Math.round(areas.cat1 * cat1GrossFactor);

  const statedTotal = data.stated_total_m2 != null ? num(data.stated_total_m2) : null;
  const confidence = clamp01(num(data.confidence) || defaultConfidence(kind));

  return {
    kind,
    areas,
    statedTotal: statedTotal && statedTotal > 0 ? statedTotal : null,
    confidence,
    method:
      cat1GrossFactor !== 1.0
        ? `${methodLabel(kind)} (×${cat1GrossFactor} net→gross)`
        : methodLabel(kind),
    buildingType: typeof data.building_type === "string" ? data.building_type : undefined,
    cat1Basis,
    cat1GrossFactor,
    floorLabel: typeof data.floor_label === "string" ? data.floor_label : undefined,
    rows,
    raw: data,
  };
}

/** Normalise a floor label for duplicate-sheet detection ("Gelijkvloers / Rez-de-Chaussée" → "gelijkvloers"). */
function normFloor(label?: string): string {
  return String(label ?? "")
    .toLowerCase()
    .split(/[\/|–-]/)[0] // drop the FR half of bilingual labels
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
}

/**
 * Aggregate per-page vision results into one building total. Multi-floor buildings
 * put each floor on its own sheet, so we must process every floor-plan page and SUM
 * (cross-page units are distinct; within-page dedup is the model's job). Validated
 * 2026-06-01: per-page + tiling + the BO/NO anti-double-count rule gave −0% on a
 * 12-floor apartment building (Die Prince) vs heated-floor GT.
 *
 * Authority order: if ANY page is a full area table, that page is authoritative
 * (exact) — we don't also sum labeled pages. Otherwise sum the labeled/measured pages.
 */
export function aggregateVisionSqm(results: Array<VisionSqmResult | null>): VisionSqmResult | null {
  const ok = results.filter((r): r is VisionSqmResult => !!r);
  if (!ok.length) return null;

  // A printed area table on any sheet wins outright (exact).
  const tables = ok.filter((r) => r.kind === "area_table" && r.areas.cat1 >= 20);
  if (tables.length) {
    return tables.reduce((a, b) => (b.areas.cat1 > a.areas.cat1 ? b : a));
  }

  const labeled = ok.filter((r) => r.kind === "labeled_plan" && r.areas.cat1 >= 5);
  const poolRaw = labeled.length ? labeled : ok;
  // Dedup DUPLICATE floor sheets (same plan bound twice, or NL+FR versions): keep the
  // best read (max cat1) per distinct floor label. Block letters survive normalisation
  // ("Gelijkvloers A" ≠ "Gelijkvloers B"), so distinct blocks are NOT merged; only true
  // duplicates ("Gelijkvloers / Rez-de-Chaussée" twice) collapse. Pages with no label
  // are each kept (cannot dedup). Validated: 23-499974 = 10 sheets → 5 unique floors.
  const byFloor = new Map<string, VisionSqmResult>();
  const pool: VisionSqmResult[] = [];
  for (const r of poolRaw) {
    const key = normFloor(r.floorLabel);
    if (!key) {
      pool.push(r);
      continue;
    }
    const prev = byFloor.get(key);
    if (!prev || r.areas.cat1 > prev.areas.cat1) byFloor.set(key, r);
  }
  pool.push(...Array.from(byFloor.values()));
  const areas = {
    cat1: pool.reduce((s, r) => s + r.areas.cat1, 0),
    cat2: pool.reduce((s, r) => s + r.areas.cat2, 0),
    cat3: pool.reduce((s, r) => s + r.areas.cat3, 0),
  };
  const kind: SqmKind = labeled.length ? "labeled_plan" : "bare_plan";
  // confidence: mean of the contributing pages, but never above the per-kind ceiling
  const meanConf = pool.reduce((s, r) => s + r.confidence, 0) / pool.length;
  const confidence = kind === "labeled_plan" ? Math.min(0.6, meanConf) : Math.min(0.35, meanConf);
  // The net→gross factor was already applied per page in extractSqmViaVision, so the
  // summed cat1 is already gross — don't re-apply. Report the dominant page basis.
  const basisCounts = pool.reduce<Record<string, number>>((m, r) => {
    m[r.cat1Basis] = (m[r.cat1Basis] ?? 0) + 1;
    return m;
  }, {});
  const cat1Basis = (Object.entries(basisCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "unknown") as Cat1Basis;
  return {
    kind,
    areas,
    statedTotal: ok.map((r) => r.statedTotal).find((t) => t && t > 0) ?? null,
    confidence,
    method: kind === "labeled_plan" ? `Printed m² labels summed across ${pool.length} sheet(s)` : methodLabel(kind),
    buildingType: ok.find((r) => r.buildingType)?.buildingType,
    cat1Basis,
    cat1GrossFactor: 1.0, // already applied per page
    rows: pool.flatMap((r) => r.rows),
    raw: { perPage: ok.length, pooled: pool.length },
  };
}

function methodLabel(kind: SqmKind): string {
  switch (kind) {
    case "area_table":
      return "Area table (berekening/meetstaat) read by vision — exact";
    case "labeled_plan":
      return "Printed m² labels summed from the plan — medium confidence";
    default:
      return "Measured from dimensions — low confidence, manual review advised";
  }
}
function defaultConfidence(kind: SqmKind): number {
  return kind === "area_table" ? 0.9 : kind === "labeled_plan" ? 0.55 : 0.3;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function pickNum(primary: unknown, fallback: number): number {
  const p = num(primary);
  return p > 0 ? p : fallback;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
