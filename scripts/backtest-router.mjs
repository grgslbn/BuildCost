/**
 * backtest-router.mjs — backtest the RELIABLE route (Tier 1: area table read by vision)
 * across many CED dossiers vs sqm-groundtruth.json. This is the production workhorse for
 * the insurer use-case (their dossier contains a berekening/oppervlaktestaat). Reports
 * per-dossier Δ + aggregate median / within-10% / within-15%.
 *
 * Usage: node scripts/backtest-router.mjs [maxDossiers]
 */
import { readFileSync, readdirSync } from "node:fs";
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
const MODEL = "claude-sonnet-4-6";
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARG = process.argv[2] || "14";
const REFS = ARG.includes("-") ? ARG.split(",").map((s) => s.trim()) : null;
const MAX = REFS ? 999 : parseInt(ARG, 10);
const NPAGES = parseInt(process.argv[3] || "5", 10);

const files = readdirSync(DIR).filter((f) => /VerzamelPDF.*\.pdf$/i.test(f) && !/kopie/i.test(f));
const work = files.map((f) => ({ f, ref: (f.match(/^(\d{2}-\d{6})/) || [])[1] }))
  .filter((x) => x.ref && gt[x.ref] && gt[x.ref].heated_m2 > 0)
  .filter((x) => (REFS ? REFS.includes(x.ref) : true)).slice(0, MAX);

const SYS = "You extract a Belgian reconstruction-cost / area table (Berekening / oppervlaktestaat / meetstaat) from the images and return ONLY JSON.";
const INSTR = `These images contain a building area/cost table. Transcribe EVERY row.
For each row: "omschrijving" (description), "opp_m2" (the Oppervlakte/Opp value in m², null if none), "cat" (cat1=heated living/finished incl. apartments+commercial+common circulation; cat2=garage/parking/kelder/berging/techniek; cat3=terras/balkon/dakterras; other=non-floor like zonnepanelen/lift/buitenaanleg/vetustiteit).
Belgian numbers 1.657,60→1657.60. Do not invent rows.
Return JSON: {"rows":[{"omschrijving","opp_m2":<n|null>,"cat":"cat1|cat2|cat3|other"}], "total_eur":<n|null>}`;

function tablePages(file) {
  let t = ""; try { t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 }); } catch { return [3, 4, 5, 6, 7]; }
  const pages = t.split("\f");
  const hit = [];
  pages.forEach((p, i) => { if (/Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl/i.test(p)) hit.push(i); });
  return hit.length ? [...new Set(hit)].slice(0, NPAGES) : [3, 4, 5, 6, 7];
}
async function render(buf, idx) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages(); const out = [];
  for (const i of idx) {
    if (i < 0 || i >= total) continue;
    try {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(165 / 72, 165 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      let png = Buffer.from(pix.asPNG()), w = pix.getWidth();
      while (png.length > 2.6e6 && w > 1500) { w = Math.floor(w * 0.82); png = await sharp(Buffer.from(pix.asPNG())).resize({ width: w }).png().toBuffer(); }
      if (png.length <= 3.4e6) out.push(png.toString("base64"));
    } catch { /* skip */ }
  }
  return out;
}
async function vision(images) {
  await sleep(1300);
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  for (let a = 0; a < 4; a++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 4500, system: SYS, messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { await sleep(4000 * (a + 1)); continue; }
    const j = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
    const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
  return null;
}

const deltas = []; let w10 = 0, w15 = 0, n = 0;
for (const { f, ref } of work) {
  try {
    const buf = readFileSync(join(DIR, f));
    const imgs = await render(buf, tablePages(f));
    if (!imgs.length) { process.stderr.write(`${ref}: no table pages\n`); continue; }
    const r = await vision(imgs);
    if (!r || !Array.isArray(r.rows)) { process.stderr.write(`${ref}: no rows\n`); continue; }
    const cat1 = r.rows.filter((x) => x.cat === "cat1").reduce((s, x) => s + (+x.opp_m2 > 0 ? +x.opp_m2 : 0), 0);
    const heated = gt[ref].heated_m2;
    if (cat1 < 20) { process.stderr.write(`${ref}: cat1<20 (no table read)\n`); continue; }
    const d = cat1 / heated - 1; deltas.push(Math.abs(d)); n++;
    if (Math.abs(d) <= 0.10) w10++; if (Math.abs(d) <= 0.15) w15++;
    process.stderr.write(`${ref.padEnd(11)} GT ${String(heated).padStart(6)} | table-cat1 ${String(Math.round(cat1)).padStart(6)} | Δ ${(d >= 0 ? "+" : "") + (d * 100).toFixed(0)}%${Math.abs(d) > 0.15 ? "  ⚠" : ""}\n`);
  } catch (e) { process.stderr.write(`${ref}: FOUT ${String(e.message).slice(0, 90)}\n`); }
}
deltas.sort((a, b) => a - b);
const med = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
process.stderr.write(`\n══ TIER-1 (area table via vision) BACKTEST ══  n=${n}  median-|Δ| ${med != null ? (med * 100).toFixed(0) : "-"}%  within 10%: ${w10}/${n}  within 15%: ${w15}/${n}\n`);
