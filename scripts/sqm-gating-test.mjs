/**
 * sqm-gating-test.mjs — validate the deployed confidence-gating end-to-end.
 * Extract all inputs the gate uses (cat1 gross / cat2 / cat3 / net unit sum / #units /
 * #levels), apply computeSqmConfidence, and measure whether the confidence LEVEL
 * separates accurate (≤25%) from inaccurate dossiers vs the heated-floor ground truth.
 * Reports a confusion matrix + median error per confidence tier.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";

// inline mirror of src/lib/sqm/sqm-confidence.ts (node can't import .ts)
function computeSqmConfidence({ cat1Sqm, cat2Sqm, cat3Sqm, netUnitSqmSum = null, unitCount = null, levelCount = null }) {
  const flags = []; let score = 1.0;
  if (cat1Sqm < 80) { flags.push("cat1 te laag"); score -= 0.6; }
  if (netUnitSqmSum != null && netUnitSqmSum > 0) {
    if (cat1Sqm < netUnitSqmSum * 0.98) { flags.push("bruto<netto"); score -= 0.5; }
    else if (cat1Sqm / netUnitSqmSum > 1.9) { flags.push("ratio hoog"); score -= 0.25; }
  }
  if (unitCount != null && unitCount > 0) {
    const pu = cat1Sqm / unitCount;
    if (pu < 35) { flags.push("m²/unit laag"); score -= 0.3; }
    else if (pu > 220) { flags.push("m²/unit hoog"); score -= 0.25; }
  }
  if (levelCount != null && levelCount >= 4) {
    const pl = cat1Sqm / levelCount;
    if (pl < 40) { flags.push("verdiepingen gemist (ernstig)"); score -= 0.55; }
    else if (pl < 60) { flags.push("verdiepingen gemist"); score -= 0.3; }
  }
  if (cat1Sqm > 0 && cat3Sqm > cat1Sqm * 0.6) { flags.push("terras groot"); score -= 0.15; }
  score = Math.max(0, Math.min(1, score));
  const level = score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low";
  return { level, score: Math.round(score * 100) / 100, flags, needsManualReview: level === "low" };
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const AKEY = env.ANTHROPIC_API_KEY;
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"))
  .filter((d) => /appartement/i.test(d.building_type || "") && (gt[d.ref]?.heated_m2 || 0) > 150)
  .slice(0, parseInt(process.argv[2] || "11", 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const INSTR = `Floor plans of ONE apartment building. Return ONLY JSON:
{"sum_net_m2":<sum of dwelling-unit net areas (Opp/BO; each unit once; exclude rooms/terras/garage)>,
 "n_units":<dwelling unit count>,"n_levels":<building levels incl ground>,
 "cat1_gross_m2":<heated livable+circulation footprint, sum over floors>,
 "cat2_m2":<garages/cellars/storage>,"cat3_m2":<terraces/balconies>}`;
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
    const r = await once(await buildImages(d.file));
    const exp = gt[d.ref].heated_m2;
    if (!r) { out.push({ ref: d.ref, exp, fail: true }); console.error(`${d.ref}: extractie-fail → review`); continue; }
    const cat1 = r.cat1_gross_m2 || 0;
    const conf = computeSqmConfidence({ cat1Sqm: cat1, cat2Sqm: r.cat2_m2 || 0, cat3Sqm: r.cat3_m2 || 0, netUnitSqmSum: r.sum_net_m2 || null, unitCount: r.n_units || null, levelCount: r.n_levels || null });
    const delta = cat1 ? cat1 / exp - 1 : null;
    out.push({ ref: d.ref, exp, cat1: Math.round(cat1), units: r.n_units, levels: r.n_levels, net: Math.round(r.sum_net_m2 || 0), level: conf.level, score: conf.score, review: conf.needsManualReview, delta, flags: conf.flags });
    console.error(`${d.ref}: cat1 ${Math.round(cat1)} vs ${exp} (Δ${delta!=null?(delta*100).toFixed(0):"?"}%) | ${conf.level} ${conf.score} ${conf.needsManualReview?"⚠REVIEW":""} ${conf.flags.length?"["+conf.flags.length+" flags]":""}`);
    await sleep(1100);
  } catch (e) { console.error(`${d.ref}: FOUT ${e.message}`); }
}
writeFileSync("scripts/sqm-gating-test.json", JSON.stringify(out, null, 1));

// ── precision of the gate: does "high & not review" ⇒ accurate? does review catch bad? ──
const acc = (o) => o.delta != null && Math.abs(o.delta) <= 0.25;
const passed = out.filter((o) => !o.fail && o.level === "high" && !o.review);
const flagged = out.filter((o) => o.fail || o.review || o.level !== "high");
const med = (a) => a.length ? a.map((o) => Math.abs(o.delta)).filter((x)=>x!=null).sort((x, y) => x - y)[Math.floor(a.filter(o=>o.delta!=null).length / 2)] : null;
console.log(`\n══ CONFIDENCE-GATING VALIDATIE (n=${out.length}) ══`);
console.log(`PASSED (high, geen review): ${passed.length}  — waarvan accuraat (≤25%): ${passed.filter(acc).length}/${passed.length}`);
console.log(`   mediaan-|Δ| passed: ${passed.length?(med(passed)*100).toFixed(0)+"%":"-"}`);
console.log(`FLAGGED (review/fail/niet-high): ${flagged.length}  — waarvan terecht (fout >25% of fail): ${flagged.filter((o) => o.fail || !acc(o)).length}/${flagged.length}`);
const goodFlaggedWrong = out.filter((o)=>acc(o)&&(o.review||o.level!=="high")).length;
console.log(`Accurate dossiers onterecht geflagd (false alarm): ${goodFlaggedWrong}`);
