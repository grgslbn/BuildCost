/**
 * sqm-dims.mjs — DIMENSION-based SQM, decomposed so the model only READS numbers and
 * CODE does the geometry. Two new levers vs the old sqm-measure.mjs:
 *   (1) 3×3 TILING per floor page → dimension text legible past the 1568px downsample.
 *   (2) the model returns RAW segment lists + overall bounds + a rectangle decomposition;
 *       this script computes the areas (no model arithmetic).
 * Per floor page → footprint; aggregate distinct floors; compare to heated-floor GT.
 *
 * Tests the exact "plan mét maatvoering, zónder m²-labels" case (542042 retail).
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
const DPI = 220;

const TESTS = [
  { file: "25-5420420plan.pdf", ref: "542042 retail", heated: 652, strict: 537, pages: [0, 1] },
  { file: "25-54628700plan.pdf", ref: "546287 gemengd", heated: 2419, strict: 1501, pages: [3, 4] },
  { file: "25-542077plan.pdf", ref: "542077 DiePrince", heated: 2009, strict: 1876, pages: [2, 3, 4, 5, 6, 7] },
];

const SYS = "You READ dimension numbers off Belgian architect floor plans and report them as raw data. You do NOT compute areas — a downstream program does the geometry. The images are overlapping CROPPED TILES of ONE floor-plan sheet. Return ONLY JSON.";
const INSTR = `These tiles are ONE floor-plan sheet. Your ONLY job: read the OUTER dimension chain that runs along the full building outline on this sheet and report the raw numbers. Do NOT calculate area.

1. Identify the building outline (the outermost walls of the whole floor, not a single room).
2. TOP edge: read the dimension chain along the entire top — list each segment in cm, left→right. Also give the single OVERALL top dimension if one is printed (the full-width number).
3. LEFT (or right) edge: same, top→bottom = the depth chain segments + overall.
4. If the floor outline is L-shaped or has wings, give a rectangle decomposition: a list of rectangles {w_m, d_m} whose areas sum to the full floor footprint. (For a simple rectangle, one entry.)
5. Report any OUTDOOR terras/balkon area that lies OUTSIDE the outer walls (so it can be excluded).
6. Which floor is this sheet (label)?

Numbers: dimensions are usually in cm (e.g. 397, 230). Belgian decimals 1.234,56→1234.56.
Return JSON:
{"floor_label":"...",
 "top_segments_cm":[...], "overall_width_m": <n or null>,
 "left_segments_cm":[...], "overall_depth_m": <n or null>,
 "rectangles_m":[{"w_m":<n>,"d_m":<n>}],
 "outdoor_terras_m2": <n or null>,
 "legible":"high|med|low", "note":"what you could/couldn't read"}`;

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
  await sleep(1200);
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  for (let a = 0; a < 4; a++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 3500, system: SYS, messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    const j = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
    const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
  return null;
}
// CODE does the geometry
const sumCm = (arr) => (Array.isArray(arr) ? arr.reduce((s, x) => s + (+x > 0 ? +x : 0), 0) : 0) / 100;
function footprintOf(r) {
  // prefer rectangle decomposition; else overall bounds; else segment sums
  if (Array.isArray(r.rectangles_m) && r.rectangles_m.length) {
    const a = r.rectangles_m.reduce((s, rc) => s + (+rc.w_m > 0 && +rc.d_m > 0 ? +rc.w_m * +rc.d_m : 0), 0);
    if (a > 0) return { area: a, how: `${r.rectangles_m.length} rect` };
  }
  const w = (+r.overall_width_m > 0 ? +r.overall_width_m : sumCm(r.top_segments_cm));
  const d = (+r.overall_depth_m > 0 ? +r.overall_depth_m : sumCm(r.left_segments_cm));
  if (w > 0 && d > 0) return { area: w * d, how: `${w.toFixed(1)}×${d.toFixed(1)}` };
  return { area: 0, how: "none" };
}

for (const t of TESTS) {
  const buf = readFileSync(`${DIR}/${t.file}`);
  let total = 0; const seen = new Map();
  for (const p of t.pages) {
    try {
      const tiles = await tilesOfPage(buf, p);
      if (!tiles.length) { process.stderr.write(`  ${t.ref} p${p}: no tiles\n`); continue; }
      const r = await vision(tiles);
      if (!r) { process.stderr.write(`  ${t.ref} p${p}: no extraction\n`); continue; }
      const fp = footprintOf(r);
      const label = (r.floor_label || `p${p}`).toLowerCase().replace(/\s+/g, "");
      // dedup identical floor sheets by label+area
      const key = label + ":" + Math.round(fp.area);
      if (seen.has(key)) { process.stderr.write(`  ${t.ref} p${p} [${r.floor_label}] DUP skip\n`); continue; }
      seen.set(key, fp.area); total += fp.area;
      process.stderr.write(`  ${t.ref} p${p} [${r.floor_label}] legible=${r.legible} footprint=${Math.round(fp.area)} (${fp.how}) terras=${r.outdoor_terras_m2 || 0}\n`);
    } catch (e) { process.stderr.write(`  ${t.ref} p${p}: FOUT ${String(e.message).slice(0, 100)}\n`); }
  }
  const dH = ((total / t.heated - 1) * 100).toFixed(0), dS = ((total / t.strict - 1) * 100).toFixed(0);
  process.stderr.write(`\n${t.ref} GT heated ${t.heated}/strict ${t.strict} → DIMS footprint-sum=${Math.round(total)} (vs heated ${dH}%, vs strict ${dS}%)\n\n`);
}
