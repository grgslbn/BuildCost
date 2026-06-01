/**
 * sqm-ensemble.mjs — attack the VARIANCE directly. Vision is stochastic, so the same
 * fixed images measured N times give different answers (−1%..−41%). Run the combined
 * extraction K times on the SAME images, take the MEDIAN of each signal (net_sum,
 * footprint), reject outliers, then combine with the gross≥net sanity rule.
 * Median-of-K collapses per-run variance — the core problem.
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
const K = parseInt(process.argv[3] || "3", 10);
const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8")).filter((d) => REFS.includes(d.ref));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function floorPages(file) {
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 });
  const pages = t.split("\f");
  const kw = /slaapkamer|leefruimte|badkamer|keuken|berging|inkomhal|traphal/gi;
  return pages.map((p, i) => ({ i, n: (p.match(kw) || []).length })).filter((s) => s.n >= 6).sort((a, b) => b.n - a.n).slice(0, 3).map((s) => s.i);
}
async function fit(png) { let p = png; let w = (await sharp(png).metadata()).width; while (p.length > 3_300_000 && w > 1400) { w = Math.floor(w * 0.82); p = await sharp(png).resize({ width: w }).png().toBuffer(); } return p.length <= 3_800_000 ? p.toString("base64") : null; }
async function buildImages(file) {
  const buf = readFileSync(join(DIR, file));
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (const i of floorPages(file)) {
    const page = doc.loadPage(i); const b = page.getBounds(); const aspect = (b[2] - b[0]) / (b[3] - b[1]);
    const pix = page.toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    const full = Buffer.from(pix.asPNG()); const W = pix.getWidth(), Hh = pix.getHeight();
    const n = aspect >= 1.6 ? 3 : aspect >= 1.1 ? 2 : 1;
    for (let s = 0; s < n; s++) {
      const left = Math.max(0, Math.floor(W * (s / n - 0.04))), w = Math.min(W - left, Math.floor(W * (1 / n + 0.08)));
      const c = n === 1 ? full : await sharp(full).extract({ left, top: 0, width: w, height: Hh }).png().toBuffer();
      const b64 = await fit(c); if (b64) out.push(b64);
    }
  }
  return out.slice(0, 5);
}

const INSTR = `Floor plans of ONE apartment building. Extract: (A) each DWELLING UNIT net area (Opp/BO; appartement/studio/woning; each once; exclude rooms/terras/garage/common); (B) per floor plan, heated BRUTO footprint = sum outer dimension segments top edge (width) × side edge (depth). Return ONLY JSON {"sum_net_m2":<n>,"n_units":<int>,"sum_footprint_m2":<n>}`;
async function once(imgs, retries = 2) {
  await sleep(1300);
  try {
    const content = [{ type: "text", text: INSTR }, ...imgs.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, system: "Belgian apartment floor plans. Return only JSON.", messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { if (retries > 0) { await sleep(8000); return once(imgs, retries - 1); } return null; }
    const j = await res.json(); const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  } catch { if (retries > 0) { await sleep(5000); return once(imgs, retries - 1); } return null; }
}

const out = [];
for (const d of bench) {
  try {
    const imgs = await buildImages(d.file);
    const nets = [], fps = [], units = [];
    for (let k = 0; k < K; k++) { const r = await once(imgs); if (r) { if (r.sum_net_m2 > 0) nets.push(r.sum_net_m2); if (r.sum_footprint_m2 > 0) fps.push(r.sum_footprint_m2); if (r.n_units > 0) units.push(r.n_units); } }
    const net = median(nets), fp = median(fps);
    // sanity-combine on the MEDIANS (variance already collapsed)
    let gross, conf;
    if (net > 0 && fp >= net * 0.98 && fp <= net * 1.8) { gross = fp; conf = "high"; }
    else if (net > 0) { gross = net * 1.3; conf = "med"; }
    else { gross = fp; conf = "low"; }
    const exp = gt[d.ref].heated_m2;
    const delta = gross ? +(gross / exp - 1).toFixed(3) : null;
    out.push({ ref: d.ref, K, net: Math.round(net), fp: Math.round(fp), nets: nets.map(Math.round), fps: fps.map(Math.round), gross: Math.round(gross), exp, conf, delta });
    console.error(`${d.ref}: net[${nets.map(Math.round)}]→${Math.round(net)} fp[${fps.map(Math.round)}]→${Math.round(fp)} ⇒ ${Math.round(gross)} [${conf}] vs ${exp}  Δ ${delta != null ? (delta >= 0 ? "+" : "") + (delta * 100).toFixed(0) + "%" : "?"}`);
    await sleep(1200);
  } catch (e) { console.error(`${d.ref}: FOUT ${e.message}`); }
}
writeFileSync("scripts/sqm-ensemble.json", JSON.stringify(out, null, 1));
const ds = out.filter((o) => o.delta != null).map((o) => Math.abs(o.delta)).sort((a, b) => a - b);
const within = (p) => ds.filter((x) => x <= p).length;
console.log(`\n══ ENSEMBLE (median-of-${K} + sanity) ══  n=${ds.length}  mediaan-|Δ| ${ds.length ? (ds[Math.floor(ds.length / 2)] * 100).toFixed(0) : "-"}%  binnen 15%: ${within(0.15)}/${ds.length}  binnen 25%: ${within(0.25)}/${ds.length}`);
console.log(`(single-run baseline: 42%; multisignaal: 61%)`);
