/**
 * sqm-rooms.mjs — "maten in de ruimtes": read each ROOM locally (its printed area OR
 * its width×depth dimensions, whichever is shown), classify heated, sum per floor, sum
 * floors. Local per-room reading is anchored to each room label, so it should be far
 * more robust than the building OUTER dimension chain (which the model misassociates).
 * Model reads numbers per room; code computes + sums.
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

const SYS = "You read Belgian architect floor plans ROOM BY ROOM. For each room you report its area — preferring a printed m² value, else its width×depth from the room's own dimension lines. The images are overlapping CROPPED TILES of ONE plan SHEET (which may show several floors). You read numbers; a program sums. Return ONLY JSON.";
const INSTR = `These tiles are ONE plan SHEET (possibly several floor plans). List EVERY room/space you can see, per floor.
For each room give:
- "floor_label": which floor it's on (e.g. "+7","Gelijkvloers").
- "room": its name (leefruimte, slaapkamer, keuken, badkamer, hal, gang, berging, garage, terras, winkel, bureau …).
- "area_m2": PREFER a printed area if one is shown next to the room. ELSE compute width×depth from the room's OWN dimension lines (the small dimensions bracketing that room). Report the resulting m².
- "from": "printed" if you read a printed m², or "dims" if you multiplied width×depth.
- "cat": cat1 = heated living/finished (apartments rooms, offices, shops, common hal/gang/traphal), cat2 = garage/parking/kelder/berging/techniek, cat3 = terras/balkon.
Do NOT also report a whole-apartment total AND its rooms — report the ROOMS (the parts), once each.
Belgian decimals 1.234,56→1234.56.
Return JSON: {"rooms":[{"floor_label","room","area_m2":<n>,"from":"printed|dims","cat":"cat1|cat2|cat3"}], "note":"how legible / dims vs printed"}`;

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
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SYS, messages: [{ role: "user", content }] }) });
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
  let cat1 = 0, cat2 = 0, cat3 = 0, nPrinted = 0, nDims = 0;
  const seen = new Set();
  for (const p of t.pages) {
    try {
      const tiles = await tilesOfPage(buf, p);
      if (!tiles.length) { process.stderr.write(`  ${t.ref} p${p}: no tiles\n`); continue; }
      const r = await vision(tiles);
      if (!r || !Array.isArray(r.rooms)) { process.stderr.write(`  ${t.ref} p${p}: no rooms\n`); continue; }
      let pc1 = 0;
      for (const rm of r.rooms) {
        const a = +rm.area_m2 || 0; if (a <= 0 || a > 2000) continue;
        const key = `${(rm.floor_label || "").toLowerCase()}|${(rm.room || "").toLowerCase()}|${Math.round(a)}`;
        if (seen.has(key)) continue; seen.add(key);
        if (rm.from === "printed") nPrinted++; else nDims++;
        if (rm.cat === "cat3") cat3 += a; else if (rm.cat === "cat2") cat2 += a; else { cat1 += a; pc1 += a; }
      }
      process.stderr.write(`  ${t.ref} p${p}: ${r.rooms.length} rooms, cat1 +${Math.round(pc1)}\n`);
    } catch (e) { process.stderr.write(`  ${t.ref} p${p}: FOUT ${String(e.message).slice(0, 100)}\n`); }
  }
  const dH = ((cat1 / t.heated - 1) * 100).toFixed(0), dS = ((cat1 / t.strict - 1) * 100).toFixed(0);
  process.stderr.write(`\n${t.ref} GT heated ${t.heated}/strict ${t.strict} → ROOMS cat1=${Math.round(cat1)} (vs heated ${dH}%, vs strict ${dS}%) cat2=${Math.round(cat2)} cat3=${Math.round(cat3)}  [printed ${nPrinted}, dims ${nDims}]\n\n`);
}
