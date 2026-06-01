/**
 * sqm-v5-validate.mjs — end-to-end validation of the v5 SQM method:
 *   page-selection (room labels) + SECTION (floor count) + segment-sum footprint
 *   + floor enumeration → total heated bruto m². ONE call per dossier (avoids the
 *   rate-limit storm of per-crop calls). Paced + retried.
 * Compares to corrected heated-floor ground truth (sqm-groundtruth.json).
 * Usage: node scripts/sqm-v5-validate.mjs [maxDossiers]
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
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const AKEY = env.ANTHROPIC_API_KEY;
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const MAX = parseInt(process.argv[2] || "12", 10);

const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"))
  .filter((d) => /appartement/i.test(d.building_type || "") && (gt[d.ref]?.heated_m2 || 0) > 120).slice(0, MAX);
const v5 = (await (await fetch(`${U}/rest/v1/prompt_versions?prompt_type=eq.sqm_extraction&version_number=eq.5&select=system_prompt`, { headers: H })).json())[0].system_prompt;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function selectPages(file) {
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 });
  const pages = t.split("\f");
  const room = /slaapkamer|leefruimte|badkamer|keuken|berging|inkomhal|traphal/gi;
  const sect = /\bsnede\b|doorsnede|gevel|terreinprofiel/gi;
  const scored = pages.map((p, i) => ({ i, room: (p.match(room) || []).length, sect: (p.match(sect) || []).length }));
  const floors = scored.filter((s) => s.room >= 5).sort((a, b) => b.room - a.room).slice(0, 3).map((s) => s.i);
  const section = scored.filter((s) => s.sect >= 2 && !floors.includes(s.i)).sort((a, b) => b.sect - a.sect)[0]?.i;
  return { floors, section };
}

async function renderPage(doc, i, dpiCrops = false) {
  const page = doc.loadPage(i);
  const b = page.getBounds();
  const aspect = (b[2] - b[0]) / (b[3] - b[1]);
  const pix = page.toPixmap(mupdf.Matrix.scale(190 / 72, 190 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
  const full = Buffer.from(pix.asPNG()); const W = pix.getWidth(), Hh = pix.getHeight();
  const imgs = [];
  // For wide multi-plan floor sheets: crop into strips (1 plan/image). Section: keep whole.
  const n = dpiCrops && aspect >= 1.6 ? 3 : dpiCrops && aspect >= 1.1 ? 2 : 1;
  for (let s = 0; s < n; s++) {
    const left = Math.max(0, Math.floor(W * (s / n - 0.04)));
    const w = Math.min(W - left, Math.floor(W * (1 / n + 0.08)));
    let c = n === 1 ? full : await sharp(full).extract({ left, top: 0, width: w, height: Hh }).png().toBuffer();
    let cw = n === 1 ? W : w;
    while (c.length > 3_400_000 && cw > 1500) { cw = Math.floor(cw * 0.82); c = await sharp(full).extract({ left, top: 0, width: w, height: Hh }).resize({ width: cw }).png().toBuffer(); }
    if (c.length <= 3_800_000) imgs.push(c.toString("base64"));
  }
  return imgs;
}

const INSTR = `Determine the TOTAL heated BRUTO floor area (m²) of this apartment building.
Images: a SECTION/elevation (shows ALL building levels stacked) + floor plan(s).
1. From the SECTION, count EVERY building level (-1 kelder, +0 gelijkvloers, +1..+N, technical). List them.
2. Mark each level heated/residential (apartments/offices/commercial/circulation) vs unheated (kelder/garage = exclude from heated).
3. Measure the typical heated-floor footprint via SEGMENT-SUM: sum the outer dimension-chain segments along the top edge (=width) and left/right edge (=depth); footprint=W×D. Decompose L-shapes.
4. For identical repeated storeys, MULTIPLY footprint × count. Ground floor / penthouse may differ — handle separately if visible.
5. total_heated_bruto_m2 = sum of footprints over ALL heated levels.
Return ONLY JSON: {"n_levels":<int>,"heated_levels":<int>,"levels":[{"label":"+1","heated":true,"footprint_m2":620}],"total_heated_bruto_m2":<number>,"note":"segments+counts used"}`;

async function callV5(images, retries = 3) {
  await sleep(1500);
  try {
    const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2500, system: v5, messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { if (retries > 0) { await sleep(8000); return callV5(images, retries - 1); } return null; }
    const j = await res.json();
    if (!res.ok) return null;
    const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    return JSON.parse(m[0]);
  } catch (e) { if (retries > 0) { await sleep(6000); return callV5(images, retries - 1); } return null; }
}

const out = [];
for (const d of bench) {
  try {
    const buf = readFileSync(join(DIR, d.file));
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    const { floors, section } = selectPages(d.file);
    const images = [];
    if (section != null) images.push(...(await renderPage(doc, section, false)));
    for (const fp of floors.slice(0, 2)) images.push(...(await renderPage(doc, fp, true)));
    const imgs = images.slice(0, 5);
    const r = await callV5(imgs);
    const pred = r?.total_heated_bruto_m2 || 0;
    const exp = gt[d.ref].heated_m2;
    out.push({ ref: d.ref, n_levels: r?.n_levels, pred: Math.round(pred), exp, delta: pred ? +(pred / exp - 1).toFixed(3) : null });
    console.error(`${d.ref}: ${r?.n_levels ?? "?"} lvls, pred ${Math.round(pred)} vs expert ${exp}  Δ ${pred ? ((pred/exp-1)*100).toFixed(0)+"%" : "FAIL"}`);
    await sleep(1500);
  } catch (e) { console.error(`${d.ref}: FOUT ${e.message}`); }
}
writeFileSync("scripts/sqm-v5-result.json", JSON.stringify(out, null, 1));
const ds = out.filter((d) => d.delta != null).map((d) => Math.abs(d.delta)).sort((a, b) => a - b);
const within = (p) => ds.filter((x) => x <= p).length;
console.log(`\n══ SQM v5 (section+segment-sum+floor-enum) vs heated-floor grondwaarheid ══`);
console.log(`n=${ds.length}  mediaan-|Δ| ${ds.length?(ds[Math.floor(ds.length/2)]*100).toFixed(0):"-"}%  gem ${ds.length?(ds.reduce((s,x)=>s+x,0)/ds.length*100).toFixed(0):"-"}%`);
console.log(`binnen 15%: ${within(0.15)}/${ds.length}   binnen 25%: ${within(0.25)}/${ds.length}`);
console.log(`(baseline zonder floor-enum: mediaan ~37%, hoge gebouwen tot −75%)`);
