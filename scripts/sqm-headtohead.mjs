/**
 * sqm-headtohead.mjs — end-to-end proof the cropping improvement makes SQM measurement
 * better. For each dossier, measure the heated footprint two ways and compare to expert:
 *   BASELINE  = each floor-plan PAGE as one full image (3 plans share ~1568px) — old behavior.
 *   IMPROVED  = each floor-plan PAGE cropped into N per-plan strips (1 plan/image) — new behavior.
 * Both use the same segment-sum measurement prompt. Reports median |Δ| baseline vs improved.
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
const REFS = (process.argv[2] || "25-542077,25-546287,25-540243,26-550795,25-547561").split(",");
const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8")).filter((d) => REFS.includes(d.ref));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function floorPages(file) {
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 });
  const pages = t.split("\f");
  const kw = /slaapkamer|leefruimte|badkamer|keuken|berging|inkomhal|traphal/gi;
  return pages.map((p, i) => ({ i, n: (p.match(kw) || []).length })).filter((s) => s.n >= 6).sort((a, b) => b.n - a.n).slice(0, 3).map((s) => s.i);
}
async function fit(png) { let p = png, w = 0; const meta = await sharp(png).metadata(); w = meta.width; while (p.length > 3_500_000 && w > 1400) { w = Math.floor(w * 0.82); p = await sharp(png).resize({ width: w }).png().toBuffer(); } return p.length <= 3_900_000 ? p.toString("base64") : null; }

async function imagesFor(file, mode) {
  const buf = readFileSync(join(DIR, file));
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (const i of floorPages(file)) {
    const page = doc.loadPage(i); const b = page.getBounds(); const aspect = (b[2] - b[0]) / (b[3] - b[1]);
    const pix = page.toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    const full = Buffer.from(pix.asPNG()); const W = pix.getWidth(), Hh = pix.getHeight();
    const n = mode === "improved" ? (aspect >= 1.6 ? 3 : aspect >= 1.1 ? 2 : 1) : 1;
    for (let s = 0; s < n; s++) {
      const left = Math.max(0, Math.floor(W * (s / n - 0.04))), w = Math.min(W - left, Math.floor(W * (1 / n + 0.08)));
      const c = n === 1 ? full : await sharp(full).extract({ left, top: 0, width: w, height: Hh }).png().toBuffer();
      const b64 = await fit(c); if (b64) out.push(b64);
    }
  }
  return out;
}

const INSTR = `This image shows one or more floor plans. For EACH distinct floor plan visible, measure the heated bruto footprint: sum the outer dimension-chain segments along the top edge (=width) and a side edge (=depth); footprint=W×D (decompose L-shapes). Return ONLY JSON {"floors":[{"label":"...","footprint_m2":<n>}]}`;
async function measure(images, retries = 3) {
  await sleep(1300);
  try {
    const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, system: "You measure Belgian floor plans. Return only JSON.", messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { if (retries > 0) { await sleep(8000); return measure(images, retries - 1); } return null; }
    const j = await res.json(); const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  } catch { if (retries > 0) { await sleep(6000); return measure(images, retries - 1); } return null; }
}
function sumFloors(r) { const seen = {}; for (const f of (r?.floors || [])) { const k = (f.label || Math.random()).toString().toLowerCase().replace(/\s+/g, ""); if (f.footprint_m2 > 20 && f.footprint_m2 < 4000) seen[k] = f.footprint_m2; } return Object.values(seen).reduce((s, x) => s + x, 0); }

const out = [];
for (const d of bench) {
  try {
    const base = sumFloors(await measure(await imagesFor(d.file, "baseline")));
    await sleep(1500);
    const imp = sumFloors(await measure(await imagesFor(d.file, "improved")));
    const exp = gt[d.ref].heated_m2;
    out.push({ ref: d.ref, exp, base: Math.round(base), imp: Math.round(imp), dBase: base ? base / exp - 1 : null, dImp: imp ? imp / exp - 1 : null });
    console.error(`${d.ref}: expert ${exp} | baseline ${Math.round(base)} (${base ? ((base/exp-1)*100).toFixed(0) : "?"}%) → improved ${Math.round(imp)} (${imp ? ((imp/exp-1)*100).toFixed(0) : "?"}%)`);
    await sleep(1500);
  } catch (e) { console.error(`${d.ref}: FOUT ${e.message}`); }
}
writeFileSync("scripts/sqm-headtohead.json", JSON.stringify(out, null, 1));
const med = (a) => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
const mb = med(out.filter((o) => o.dBase != null).map((o) => Math.abs(o.dBase)));
const mi = med(out.filter((o) => o.dImp != null).map((o) => Math.abs(o.dImp)));
console.log(`\n══ Baseline (vol blad) vs Verbeterd (per-plan crop) — mediaan |Δ| ══`);
console.log(`  BASELINE: ${mb != null ? (mb * 100).toFixed(0) + "%" : "-"}    VERBETERD: ${mi != null ? (mi * 100).toFixed(0) + "%" : "-"}   (n=${out.length})`);
