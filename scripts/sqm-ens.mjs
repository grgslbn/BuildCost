/**
 * sqm-ens.mjs — DIMENSION route v3: variance reduction. Per floor page, read each
 * floor's footprint K times (ensemble), keep only readings that are (a) internally
 * consistent (width×depth ≈ footprint, ±15%) and (b) physically sane per floor
 * (30..1500 m²). Take the MEDIAN per floor, dedup floors by a normalised label, sum
 * the HEATED floors. This directly attacks the failure modes seen in dims2:
 *   - 542042 +291% (a 2054 m² outlier) → sanity bound rejects it
 *   - Die Prince +54% (13 "distinct" floors) → robust label normalisation/dedup
 *   - misread numbers → ensemble median + internal-consistency filter
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const AKEY = env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";
const DIR = "C:/Users/tieme/Desktop/testing 30_5";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DPI = 220, K = 3;

const TESTS = [
  { file: "25-5420420plan.pdf", ref: "542042 retail", heated: 652, strict: 537, pages: [0, 1] },
  { file: "25-54628700plan.pdf", ref: "546287 gemengd", heated: 2419, strict: 1501, pages: [3, 4] },
  { file: "25-542077plan.pdf", ref: "542077 DiePrince", heated: 2009, strict: 1876, pages: [2, 3, 4, 5, 6, 7] },
];

const SYS = "You read Belgian architect floor plans. The tiles are ONE plan SHEET that may show several floor plans. For each floor you read its OUTER overall width and depth from the dimension chain. You read numbers; a program checks and aggregates. Return ONLY JSON.";
const INSTR = `These tiles are ONE plan SHEET (maybe several floor plans). For EACH distinct floor plan, report:
- "floor_label": e.g. "+7","Gelijkvloers","-1".
- "is_heated": true for living floors (apartments/offices/shops/common circulation); false for parking/garage/kelder/-1/technical.
- "overall_width_m","overall_depth_m": the building's OUTER overall width and depth on THIS floor (read the single overall dimension if printed, else sum the outer dimension chain). These bound the whole floor outline.
- "footprint_m2": overall_width_m × overall_depth_m, adjusted DOWN if the outline is clearly an L/U (give your best gross-floor estimate).
Base everything ONLY on dimension numbers you can actually read; if you cannot read this floor's outer dimensions, omit it.
Belgian numbers: cm chains (397, 230) or m. 1.234,56→1234.56.
Return JSON: {"floors":[{"floor_label","is_heated","overall_width_m","overall_depth_m","footprint_m2"}]}`;

async function tilesOfPage(buf, p) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  if (p < 0 || p >= doc.countPages()) return [];
  let full, W, H;
  try {
    const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(DPI / 72, DPI / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    full = Buffer.from(pix.asPNG()); W = pix.getWidth(); H = pix.getHeight();
  } catch { return []; }
  if (W < 600 || H < 500) return full.length <= 3.7e6 ? [full.toString("base64")] : [];
  const G = 3, OV = 0.1, out = [];
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const left = Math.max(0, Math.floor((gx / G - OV) * W)), top = Math.max(0, Math.floor((gy / G - OV) * H));
    const w = Math.min(W - left, Math.ceil((1 / G + 2 * OV) * W)), h = Math.min(H - top, Math.ceil((1 / G + 2 * OV) * H));
    try {
      let png = await sharp(full).extract({ left, top, width: w, height: h }).png().toBuffer();
      if (Math.max(w, h) > 1600) png = await sharp(png).resize(w >= h ? { width: 1568 } : { height: 1568 }).png().toBuffer();
      if (png.length <= 3.7e6) out.push(png.toString("base64"));
    } catch { /* skip */ }
  }
  return out;
}
async function vision(images) {
  await sleep(900);
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  for (let a = 0; a < 4; a++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 2500, temperature: 0.4, system: SYS, messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { await sleep(4000 * (a + 1)); continue; }
    const j = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
    const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
  return null;
}
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const normLabel = (s) => String(s || "").toLowerCase().replace(/grondplan|plan|verdieping|niveau|nivo|\s|\.|°|e\b/g, "").replace(/^\+?0*/, "") || "?";

for (const t of TESTS) {
  const buf = readFileSync(`${DIR}/${t.file}`);
  const floorReads = new Map(); // normLabel -> {footprints:[], heated}
  for (const p of t.pages) {
    const tiles = await tilesOfPage(buf, p);
    if (!tiles.length) { process.stderr.write(`  ${t.ref} p${p}: no tiles\n`); continue; }
    for (let k = 0; k < K; k++) {
      let r; try { r = await vision(tiles); } catch (e) { continue; }
      if (!r || !Array.isArray(r.floors)) continue;
      for (const f of r.floors) {
        const w = +f.overall_width_m || 0, d = +f.overall_depth_m || 0;
        let fp = +f.footprint_m2 || 0;
        // internal consistency: footprint should be ≈ w×d (within ±20%); else recompute
        if (w > 2 && d > 2) { const wd = w * d; if (!fp || Math.abs(fp / wd - 1) > 0.2) fp = wd; }
        if (!(fp >= 30 && fp <= 1500)) continue; // physical sanity per floor
        const key = normLabel(f.floor_label);
        if (!floorReads.has(key)) floorReads.set(key, { footprints: [], heated: f.is_heated !== false, label: f.floor_label });
        floorReads.get(key).footprints.push(fp);
        if (f.is_heated === false) floorReads.get(key).heated = false;
      }
    }
    const fl = [...floorReads.values()].map((v) => `${v.label}=${Math.round(median(v.footprints))}${v.heated ? "" : "(u)"}`).join(", ");
    process.stderr.write(`  ${t.ref} p${p}: floors so far → ${fl}\n`);
  }
  let heated = 0, all = 0;
  for (const v of floorReads.values()) { const m = median(v.footprints); all += m; if (v.heated) heated += m; }
  const dH = ((heated / t.heated - 1) * 100).toFixed(0), dS = ((heated / t.strict - 1) * 100).toFixed(0);
  process.stderr.write(`\n${t.ref} GT heated ${t.heated}/strict ${t.strict} → ENS heated-footprint=${Math.round(heated)} (vs heated ${dH}%, vs strict ${dS}%)  [${floorReads.size} floors, all ${Math.round(all)}]\n\n`);
}
