/**
 * sqm-tile-full.mjs — FULL-capture label route: tile EACH floor-plan page, one vision
 * call per page, aggregate (dedup within page) across all floors. Confirms the real
 * achievable accuracy of the labeled_plan route when every floor sheet is processed.
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
const DPI = 200;

// floor-plan pages (0-indexed) per the earlier page-content scan
const TESTS = [
  { file: "25-5420420plan.pdf", ref: "25-542042 (retail)", heated: 652, strict: 537, pages: [0, 1] },
  { file: "25-54628700plan.pdf", ref: "25-546287 (gemengd)", heated: 2419, strict: 1501, pages: [3, 4] },
  { file: "25-542077plan.pdf", ref: "25-542077 (Die Prince)", heated: 2009, strict: 1876, pages: [2, 3, 4, 5, 6, 7] },
];

const SYS = "You read printed area labels (m²) off Belgian architect floor plans. Each image is an overlapping CROPPED TILE of ONE floor-plan sheet (same label may appear in two tiles — count ONCE). Return ONLY JSON.";
const INSTR = `These overlapping TILES are ONE floor-plan sheet of a building. Read the printed area labels.
CRITICAL — do NOT double-count. Belgian plans label a unit's GROSS area ("BO","bruto","Opp.") AND the rooms inside it ("NO","netto": leefruimte, slaapkamer, badkamer, nachthal…). Report the UNIT-level area ONCE per unit; do NOT also add its interior rooms. If a unit/apartment has a BO/Opp total, use that and SKIP its NO room labels. Only sum room labels when there is no unit total. Each terras/balkon is its own cat3 row.
Category "cat": cat1 = heated/living/finished (apartment BO totals, houses, offices, shops, common circulation gemene delen/traphal/inkomhal, kern/schacht), cat2 = garage/parking/kelder/berging/techniek, cat3 = terras/balkon/dakterras, other = non-floor (rookluik/leiding/schacht-leeg).
Belgian numbers 1.234,56→1234.56. Dedup by label text.
Return JSON: {"areas":[{"label":"...","m2":<n>,"cat":"cat1|cat2|cat3|other"}],"level":"<which floor this sheet is>","confidence":<0..1>}`;

async function tilesOfPage(buf, p) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  if (p < 0 || p >= doc.countPages()) return [];
  let full, W, H;
  try {
    const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(DPI / 72, DPI / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    full = Buffer.from(pix.asPNG()); W = pix.getWidth(); H = pix.getHeight();
  } catch { return []; }
  if (W < 600 || H < 500) return full.length <= 3.7e6 ? [full.toString("base64")] : [];
  const G = 3, OV = 0.08, out = [];
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
  let cat1 = 0, cat2 = 0, cat3 = 0, allLabels = [];
  for (const p of t.pages) {
    try {
      const tiles = await tilesOfPage(buf, p);
      if (!tiles.length) { process.stderr.write(`  ${t.ref} p${p}: no tiles\n`); continue; }
      const r = await vision(tiles);
      if (!r || !Array.isArray(r.areas)) { process.stderr.write(`  ${t.ref} p${p}: no extraction\n`); continue; }
      const s = (c) => r.areas.filter((a) => a.cat === c).reduce((x, a) => x + (+a.m2 > 0 ? +a.m2 : 0), 0);
      cat1 += s("cat1"); cat2 += s("cat2"); cat3 += s("cat3");
      allLabels.push(...r.areas.filter((a) => a.cat === "cat1").map((a) => `${a.label}=${a.m2}`));
      process.stderr.write(`  ${t.ref} p${p} [${r.level || "?"}]: cat1 +${Math.round(s("cat1"))} cat2 +${Math.round(s("cat2"))} cat3 +${Math.round(s("cat3"))}\n`);
    } catch (e) { process.stderr.write(`  ${t.ref} p${p}: FOUT ${String(e.message).slice(0, 100)}\n`); }
  }
  const dH = ((cat1 / t.heated - 1) * 100).toFixed(0), dS = ((cat1 / t.strict - 1) * 100).toFixed(0);
  process.stderr.write(`\n${t.ref} GT heated ${t.heated} / strict ${t.strict}  →  FULL-CAPTURE cat1=${Math.round(cat1)} (vs heated ${dH}%, vs strict ${dS}%) cat2=${Math.round(cat2)} cat3=${Math.round(cat3)}\n`);
  process.stderr.write(`   cat1 labels (${allLabels.length}): ${allLabels.slice(0, 30).join(", ")}\n\n`);
}
