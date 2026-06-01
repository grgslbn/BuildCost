/**
 * sqm-guided-crop.mjs — fix the input-variance root cause: instead of BLIND vertical
 * thirds, let vision LOCATE each floor plan on the sheet (bounding box + label),
 * then crop EACH precisely at high-res and measure its footprint (segment-sum).
 * Clean single-plan input → reliable measurement (Liedekerke proved −1% when clean).
 * Compares to baseline (blind crop, ~42% median) and expert ground truth.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const AKEY = env.ANTHROPIC_API_KEY;
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const REFS = (process.argv[2] || "25-542077,25-546287,25-540243,26-550795,24-516605").split(",");
const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8")).filter((d) => REFS.includes(d.ref));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function floorPages(file) {
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 });
  const pages = t.split("\f");
  const kw = /slaapkamer|leefruimte|badkamer|keuken|berging|inkomhal|traphal/gi;
  return pages.map((p, i) => ({ i, n: (p.match(kw) || []).length })).filter((s) => s.n >= 6).sort((a, b) => b.n - a.n).slice(0, 2).map((s) => s.i);
}
async function api(content, max = 1500, retries = 3) {
  await sleep(1300);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: max, system: "You analyze Belgian architect floor-plan sheets. Return only JSON.", messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { if (retries > 0) { await sleep(8000); return api(content, max, retries - 1); } return null; }
    const j = await res.json(); const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  } catch { if (retries > 0) { await sleep(6000); return api(content, max, retries - 1); } return null; }
}
async function b64fit(png) { let p = png; const w0 = (await sharp(png).metadata()).width; let w = w0; while (p.length > 3_300_000 && w > 1400) { w = Math.floor(w * 0.82); p = await sharp(png).resize({ width: w }).png().toBuffer(); } return p.length <= 3_800_000 ? p.toString("base64") : null; }

const LOCATE = `This is an architect sheet that may contain SEVERAL floor plans (Gelijkvloers, verdiepingen…) plus sections/details/title block. Locate ONLY the distinct FLOOR PLANS (room-layout drawings, top-down). For each, give its label and bounding box as FRACTIONS of image width/height (0-1). Ignore sections/elevations/details/legends.
Return ONLY JSON: {"plans":[{"label":"Gelijkvloers","x0":0.0,"y0":0.0,"x1":0.35,"y1":1.0}]}`;
const MEASURE = `This image is ONE floor plan. Measure the heated BRUTO footprint: sum the outer dimension-chain segments along the top edge (=width) and a side edge (=depth); footprint=W×D. Decompose L-shapes. Return ONLY JSON {"footprint_m2":<n>,"width_m":<n>,"depth_m":<n>}`;

const out = [];
for (const d of bench) {
  try {
    const buf = readFileSync(join(DIR, d.file));
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    const floors = {};
    for (const pi of floorPages(d.file)) {
      const page = doc.loadPage(pi);
      // low-res for locating
      const lo = await b64fit(Buffer.from(page.toPixmap(mupdf.Matrix.scale(110 / 72, 110 / 72), mupdf.ColorSpace.DeviceRGB, false, true).asPNG()));
      if (!lo) continue;
      const loc = await api([{ type: "text", text: LOCATE }, { type: "image", source: { type: "base64", media_type: "image/png", data: lo } }], 1000);
      const plans = (loc?.plans || []).filter((p) => (p.x1 - p.x0) > 0.08 && (p.y1 - p.y0) > 0.08);
      // hi-res render for precise crops
      const hi = page.toPixmap(mupdf.Matrix.scale(240 / 72, 240 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      const hiPng = Buffer.from(hi.asPNG()); const W = hi.getWidth(), Hh = hi.getHeight();
      for (const p of plans.slice(0, 4)) {
        const left = Math.max(0, Math.floor((p.x0 - 0.02) * W)), top = Math.max(0, Math.floor((p.y0 - 0.02) * Hh));
        const w = Math.min(W - left, Math.floor((p.x1 - p.x0 + 0.04) * W)), h = Math.min(Hh - top, Math.floor((p.y1 - p.y0 + 0.04) * Hh));
        if (w < 200 || h < 200) continue;
        const crop = await sharp(hiPng).extract({ left, top, width: w, height: h }).png().toBuffer();
        const cb = await b64fit(crop); if (!cb) continue;
        const r = await api([{ type: "text", text: MEASURE }, { type: "image", source: { type: "base64", media_type: "image/png", data: cb } }], 600);
        if (r?.footprint_m2 > 30 && r.footprint_m2 < 3000) {
          const k = (p.label || "?").toLowerCase().replace(/\s+/g, "");
          floors[k] = r.footprint_m2;
        }
      }
    }
    const gross = Object.values(floors).reduce((s, x) => s + x, 0);
    const exp = gt[d.ref].heated_m2;
    out.push({ ref: d.ref, floors: Object.keys(floors).length, gross: Math.round(gross), exp, delta: gross ? +(gross / exp - 1).toFixed(3) : null });
    console.error(`${d.ref}: ${Object.keys(floors).length} plans, gross ${Math.round(gross)} vs expert ${exp}  Δ ${gross ? ((gross/exp-1)*100).toFixed(0)+"%" : "?"}`);
    await sleep(1200);
  } catch (e) { console.error(`${d.ref}: FOUT ${e.message}`); }
}
writeFileSync("scripts/sqm-guided-crop.json", JSON.stringify(out, null, 1));
const ds = out.filter((o) => o.delta != null).map((o) => Math.abs(o.delta)).sort((a, b) => a - b);
const within = (p) => ds.filter((x) => x <= p).length;
console.log(`\n══ VISION-GELEIDE CROP + meting ══  n=${ds.length}  mediaan-|Δ| ${ds.length ? (ds[Math.floor(ds.length / 2)] * 100).toFixed(0) : "-"}%  binnen 15%: ${within(0.15)}/${ds.length}  binnen 25%: ${within(0.25)}/${ds.length}`);
console.log(`(baseline blinde-crop: mediaan 42%)`);
