/**
 * sqm-dims2.mjs — DIMENSION route v2. Fixes the floor-enumeration bug: a single sheet
 * often holds MULTIPLE floor plans (Gelijkvloers + 1e + 2e side by side). The model now
 * ENUMERATES every distinct floor plan on the sheet and gives each its own footprint
 * (from its outer dimension chain); code sums the HEATED floors (dedup by label).
 * Tiling keeps the dimension text legible. Model reads numbers, code does geometry.
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

const SYS = "You read Belgian architect floor plans and report each floor's outer footprint from its dimension chains. The images are overlapping CROPPED TILES of ONE plan SHEET that may contain SEVERAL floor plans side by side. You read numbers; a program does the rest. Return ONLY JSON.";
const INSTR = `These tiles are ONE plan SHEET. It may show SEVERAL distinct floor plans (e.g. "Gelijkvloers", "1e verdieping", "+7", "+8", "-1 parking") next to each other. Enumerate EVERY distinct floor plan visible.

For EACH floor plan:
- "floor_label": its title (e.g. "+7", "Gelijkvloers", "-1").
- "is_heated": true for LIVING floors (apartments/offices/shops/common circulation). false for parking/garage/cellar/-1/pure-technical floors.
- "footprint_m2": the GROSS outer-wall area of THAT floor. Read its OUTER dimension chain — overall width × overall depth (sum the segment chain if no single overall number is printed). If the outline is L-shaped, decompose into rectangles and sum. Do the multiplication yourself but base it ONLY on dimension numbers you can actually read.
- "width_m","depth_m": the overall outer width and depth you used (for checking).
- "outdoor_terras_m2": terras/balkon OUTSIDE the outer walls (so it can be excluded).
- "legible": "high|med|low" — how confidently you read this floor's outer chain.

Dimensions are usually cm (397, 230 …). Belgian decimals 1.234,56→1234.56.
Return JSON: {"floors":[{"floor_label","is_heated","footprint_m2","width_m","depth_m","outdoor_terras_m2","legible"}], "n_floor_plans_on_sheet":<int>, "note":"..."}`;

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
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYS, messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    const j = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
    const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
  return null;
}

for (const t of TESTS) {
  const buf = readFileSync(`${DIR}/${t.file}`);
  const floors = new Map(); // floor_label -> {footprint, heated}
  for (const p of t.pages) {
    try {
      const tiles = await tilesOfPage(buf, p);
      if (!tiles.length) { process.stderr.write(`  ${t.ref} p${p}: no tiles\n`); continue; }
      const r = await vision(tiles);
      if (!r || !Array.isArray(r.floors)) { process.stderr.write(`  ${t.ref} p${p}: no floors\n`); continue; }
      for (const f of r.floors) {
        const fp = +f.footprint_m2 || 0;
        if (fp <= 0) continue;
        const key = String(f.floor_label || "?").toLowerCase().replace(/\s+/g, "");
        // keep the larger reading if a floor appears on two sheets (overlap)
        const prev = floors.get(key);
        if (!prev || fp > prev.footprint) floors.set(key, { footprint: fp, heated: f.is_heated !== false, label: f.floor_label });
      }
      const labels = r.floors.map((f) => `${f.floor_label}=${Math.round(+f.footprint_m2 || 0)}${f.is_heated === false ? "(unheated)" : ""}`).join(", ");
      process.stderr.write(`  ${t.ref} p${p}: ${r.n_floor_plans_on_sheet || r.floors.length} floors → ${labels}\n`);
    } catch (e) { process.stderr.write(`  ${t.ref} p${p}: FOUT ${String(e.message).slice(0, 100)}\n`); }
  }
  let heatedSum = 0, allSum = 0;
  for (const v of floors.values()) { allSum += v.footprint; if (v.heated) heatedSum += v.footprint; }
  const dH = ((heatedSum / t.heated - 1) * 100).toFixed(0), dS = ((heatedSum / t.strict - 1) * 100).toFixed(0);
  process.stderr.write(`\n${t.ref} GT heated ${t.heated}/strict ${t.strict} → DIMS2 heated-footprint=${Math.round(heatedSum)} (vs heated ${dH}%, vs strict ${dS}%)  [all floors ${Math.round(allSum)}, ${floors.size} distinct]\n\n`);
}
