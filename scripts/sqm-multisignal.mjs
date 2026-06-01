/**
 * sqm-multisignal.mjs — robust SQM via TWO signals + physical sanity-check.
 * One call per dossier extracts BOTH: (a) the dwelling-unit net areas (reliable read)
 * and (b) the per-floor footprint (segment-sum). Then combine:
 *   - gross_heated MUST be ≥ net_sum (physics: gross includes walls+circulation).
 *   - if footprint is plausible (net_sum ≤ footprint ≤ net_sum×1.8) → use footprint.
 *   - else (footprint failed / catastrophic) → fall back to net_sum × 1.3.
 * This catches the catastrophic measurement failures (e.g. 73 m² for a real building).
 * Validated vs corrected heated-floor ground truth. Paced + retried.
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
const MAX = parseInt(process.argv[2] || "10", 10);
const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"))
  .filter((d) => /appartement/i.test(d.building_type || "") && (gt[d.ref]?.heated_m2 || 0) > 150).slice(0, MAX);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function floorPages(file) {
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 });
  const pages = t.split("\f");
  const kw = /slaapkamer|leefruimte|badkamer|keuken|berging|inkomhal|traphal/gi;
  return pages.map((p, i) => ({ i, n: (p.match(kw) || []).length })).filter((s) => s.n >= 6).sort((a, b) => b.n - a.n).slice(0, 3).map((s) => s.i);
}
async function fit(png) { let p = png; const meta = await sharp(png).metadata(); let w = meta.width; while (p.length > 3_300_000 && w > 1400) { w = Math.floor(w * 0.82); p = await sharp(png).resize({ width: w }).png().toBuffer(); } return p.length <= 3_800_000 ? p.toString("base64") : null; }
async function images(file) {
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

const INSTR = `These images are the floor plans of ONE apartment building. Extract BOTH:
A) Every DWELLING UNIT's net floor area (appartement/studio/woning/duplex + a number; the "Opp/BO" value). Each unit ONCE. Exclude rooms, terraces, garages, common areas.
B) Per visible floor plan, the heated BRUTO footprint: sum the outer dimension-chain segments along the top edge (=width) and a side edge (=depth); footprint=W×D (decompose L-shapes). Count identical repeated storeys × their number if a section shows them.
Return ONLY JSON: {"units":[{"label":"app 0.3A","net_m2":104.3}],"sum_net_m2":<n>,"floors":[{"label":"+1","footprint_m2":620}],"sum_footprint_m2":<n>,"n_levels_total":<int>}`;

async function extract(imgs, retries = 3) {
  await sleep(1300);
  try {
    const content = [{ type: "text", text: INSTR }, ...imgs.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 3000, system: "You read Belgian apartment floor plans. Return only JSON.", messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { if (retries > 0) { await sleep(8000); return extract(imgs, retries - 1); } return null; }
    const j = await res.json(); const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  } catch { if (retries > 0) { await sleep(6000); return extract(imgs, retries - 1); } return null; }
}

function combine(r) {
  const net = r?.sum_net_m2 || (r?.units || []).reduce((s, u) => s + (u.net_m2 || 0), 0);
  const fp = r?.sum_footprint_m2 || (r?.floors || []).reduce((s, f) => s + (f.footprint_m2 || 0), 0);
  // physical rule: gross ≥ net. footprint plausible if net ≤ fp ≤ net×1.8.
  let gross, method, conf;
  if (net > 0 && fp >= net * 0.98 && fp <= net * 1.8) { gross = fp; method = "footprint"; conf = "high"; }
  else if (net > 0) { gross = net * 1.3; method = "net×1.3 (footprint rejected)"; conf = fp > 0 && fp < net * 0.98 ? "med" : "low"; }
  else { gross = fp; method = "footprint-only"; conf = "low"; }
  return { net: Math.round(net), fp: Math.round(fp), gross: Math.round(gross), method, conf };
}

const out = [];
for (const d of bench) {
  try {
    const r = await extract(await images(d.file));
    const c = combine(r);
    const exp = gt[d.ref].heated_m2;
    const delta = c.gross ? c.gross / exp - 1 : null;
    out.push({ ref: d.ref, exp, ...c, delta });
    console.error(`${d.ref}: net ${c.net} fp ${c.fp} → ${c.gross} [${c.method}, ${c.conf}] vs expert ${exp}  Δ ${delta != null ? (delta >= 0 ? "+" : "") + (delta * 100).toFixed(0) + "%" : "?"}`);
    await sleep(1200);
  } catch (e) { console.error(`${d.ref}: FOUT ${e.message}`); }
}
writeFileSync("scripts/sqm-multisignal.json", JSON.stringify(out, null, 1));
const ds = out.filter((o) => o.delta != null).map((o) => Math.abs(o.delta)).sort((a, b) => a - b);
const within = (p) => ds.filter((x) => x <= p).length;
console.log(`\n══ MULTI-SIGNAAL SQM (footprint + netto + sanity-check) ══`);
console.log(`n=${ds.length}  mediaan-|Δ| ${ds.length ? (ds[Math.floor(ds.length / 2)] * 100).toFixed(0) : "-"}%  gem ${ds.length ? (ds.reduce((s, x) => s + x, 0) / ds.length * 100).toFixed(0) : "-"}%`);
console.log(`binnen 10%: ${within(0.10)}/${ds.length}  binnen 15%: ${within(0.15)}/${ds.length}  binnen 25%: ${within(0.25)}/${ds.length}`);
console.log(`(baseline footprint-only: mediaan 42%, catastrofes tot −96%)`);
