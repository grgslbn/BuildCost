/**
 * sqm-measure.mjs — SQM approach B: robust footprint measurement.
 *  1. Page selection by ROOM-LABEL text density (reliable, text-based).
 *  2. Render each floor-plan page high-DPI, crop into vertical strips (1 plan/image).
 *  3. Tight vision prompt: SUM the dimension-chain segments along the outer top edge
 *     (=width) and left edge (=depth) → footprint = W×D. (Reading+adding, not "which
 *     is the outer dim" guessing, not pixel measurement.)
 *  4. Aggregate per dossier, dedupe identical floors, compare to expert GROSS woon.
 * Usage: node scripts/sqm-measure.mjs [maxDossiers]
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
const REFS = (process.argv[2] || "").split(",").filter(Boolean);
const experts = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"))
  .filter((d) => /appartement/i.test(d.building_type || "") && d.cats.cat1.opp > 80)
  .filter((d) => REFS.length ? REFS.includes(d.ref) : true).slice(0, REFS.length || 6);

const SYS = `You measure the BRUTO (gross, outer-wall) floor area of Belgian apartment floor plans. Return ONLY JSON.`;
const INSTR = `Each image is ONE floor plan of an apartment building (rendered crop). For the floor plan shown:
1. Find the floor label (e.g. "Gelijkvloers", "1e verdieping", "+3", "Nivo 2").
2. Read the OUTER dimension chain along the TOP edge of the building: list each segment (cm) and SUM them = building WIDTH (m). (e.g. 397+230+150+473 = 1250 cm = 12.50 m)
3. Read the OUTER dimension chain along the LEFT (or right) edge: sum the segments = building DEPTH (m).
4. footprint_bruto_m2 = WIDTH × DEPTH. If the shape is L/irregular, decompose into rectangles and sum.
5. Note any large OUTDOOR terraces (terras/balkon) that are OUTSIDE the outer walls — give their m² so they can be excluded from the heated area.
Return JSON: {"floor_label":"...","width_m":<n>,"depth_m":<n>,"footprint_bruto_m2":<n>,"outdoor_terras_m2":<n>,"confidence":"high|med|low","note":"the segments you summed"}
If you cannot read the outer dimension chain, set confidence "low" and estimate footprint from the apartment net areas × 1.3.`;

function pickFloorPages(buf, file) {
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 });
  const pages = t.split("\f");
  const kw = /slaapkamer|leefruimte|badkamer|keuken|terras|berging|inkomhal|traphal|nachthal/gi;
  const scored = pages.map((p, i) => ({ i, n: (p.match(kw) || []).length }));
  return scored.filter((s) => s.n >= 5).sort((a, b) => b.n - a.n).slice(0, 7).map((s) => s.i);
}

async function cropsForPage(buf, i) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const page = doc.loadPage(i);
  const b = page.getBounds();
  const aspect = (b[2] - b[0]) / (b[3] - b[1]);
  const pix = page.toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
  const full = Buffer.from(pix.asPNG()); const W = pix.getWidth(), Hh = pix.getHeight();
  const n = aspect >= 1.6 ? 3 : aspect >= 1.1 ? 2 : 1; // plans-in-a-row estimate
  const out = [];
  for (let s = 0; s < n; s++) {
    const left = Math.max(0, Math.floor(W * (s / n - 0.05)));
    const w = Math.min(W - left, Math.floor(W * (1 / n + 0.1)));
    let c = await sharp(full).extract({ left, top: 0, width: w, height: Hh }).png().toBuffer();
    let cw = w;
    while (c.length > 3_600_000 && cw > 1400) { cw = Math.floor(cw * 0.8); c = await sharp(full).extract({ left, top: 0, width: w, height: Hh }).resize({ width: cw }).png().toBuffer(); }
    if (c.length <= 3_900_000) out.push(c.toString("base64"));
  }
  return out;
}

async function measure(b64, retries = 2) {
  await new Promise((r) => setTimeout(r, 1200)); // pace calls to avoid rate-limit/fetch-fail
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1200, system: SYS, messages: [{ role: "user", content: [{ type: "text", text: INSTR }, { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }] }] }) });
    const j = await res.json();
    if (!res.ok) return null;
    const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    return JSON.parse(m[0]);
  } catch (e) {
    if (retries > 0) { await new Promise((r) => setTimeout(r, 3000)); return measure(b64, retries - 1); }
    return null;
  }
}

const out = [];
for (const e of experts) {
  try {
    const buf = readFileSync(join(DIR, e.file));
    const pages = pickFloorPages(buf, e.file);
    const floors = {};
    for (const pi of pages) {
      for (const b64 of await cropsForPage(buf, pi)) {
        const r = await measure(b64);
        if (r && r.footprint_bruto_m2 > 20 && r.footprint_bruto_m2 < 4000) {
          const key = (r.floor_label || "?").toLowerCase().replace(/\s+/g, "");
          if (!floors[key] || r.confidence === "high") floors[key] = r.footprint_bruto_m2;
        }
      }
    }
    const grossPred = Object.values(floors).reduce((s, x) => s + x, 0);
    const expGross = e.cats.cat1.opp;
    out.push({ ref: e.ref, floors: Object.keys(floors).length, grossPred: Math.round(grossPred), expGross: Math.round(expGross), delta: grossPred ? +(grossPred / expGross - 1).toFixed(3) : null });
    console.error(`${e.ref}: ${Object.keys(floors).length} floors, gross-pred ${Math.round(grossPred)} vs expert ${Math.round(expGross)}  Δ ${grossPred ? ((grossPred/expGross-1)*100).toFixed(0)+"%" : "?"}`);
  } catch (err) { console.error(`${e.ref}: FOUT ${err.message}`); }
}
writeFileSync("scripts/sqm-measure.json", JSON.stringify(out, null, 1));
const ds = out.filter((d) => d.delta != null).map((d) => Math.abs(d.delta));
console.log(`\n══ SQM bruto-footprint meting (segment-som) ══  n=${ds.length}  mediaan-|Δ| ${(ds.sort((a,b)=>a-b)[Math.floor(ds.length/2)]*100).toFixed(0)}%  gem ${(ds.reduce((s,x)=>s+x,0)/ds.length*100).toFixed(0)}%`);
