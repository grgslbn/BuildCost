/**
 * harvest-gt.mjs — leest de berekening/oppervlaktestaat van VerzamelPDFs via vision
 * (de gevalideerde Tier-1 route, niveau-bewust) en schrijft per-dossier GT naar
 * scripts/gt-auto.json: { ref: { cat1_m2, cat2_m2, cat3_m2, rows, total_eur } }.
 * Dient als ground truth voor de chain-reader backtest (Fase 3).
 *
 * Usage: node scripts/harvest-gt.mjs <ref1,ref2,...> | --from-inventory=dims_only_vector [--max=N]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const MODEL = "claude-opus-5";
const DIRS = ["C:/Users/tieme/Mijn Drive/M²Value/field/ALL", "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building"];
const OUTFILE = join(ROOT, "scripts", "gt-auto.json");
const gtOut = existsSync(OUTFILE) ? JSON.parse(readFileSync(OUTFILE, "utf8")) : {};

const fromInv = (process.argv.find((a) => a.startsWith("--from-inventory=")) || "").slice(17);
const MAXN = parseInt((process.argv.find((a) => a.startsWith("--max=")) || "").slice(6) || "30", 10);
let refs;
if (fromInv) {
  const inv = readFileSync(join(ROOT, "scripts", "inventory.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  refs = [...new Set(inv.filter((r) => !r.error && r.planClass === fromInv && r.hasTable && r.ref).map((r) => r.ref))].slice(0, MAXN);
} else {
  refs = (process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
}
if (!refs.length) { console.error("geen refs"); process.exit(1); }
console.log(`${refs.length} refs, model ${MODEL}`);

const TABLE_RE = /Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl|Surf\/contenu/i;
const SYS = "You extract a Belgian reconstruction-cost / area table (Berekening / oppervlaktestaat / meetstaat) from the images and return ONLY JSON.";
const INSTR = `These images contain a building area/cost table (possibly split over pages). Transcribe EVERY area row.
For each row give: "omschrijving", "niveau" (the level/niveau column value if present, else null), "opp_m2" (Oppervlakte in m², null if none), "hoogte_m" (Hauteur/hoogte if the row is VOLUME-based, else null), "cat".
Categorise using BOTH omschrijving AND niveau: cat1 = heated/finished living (apartments, woon, kantoor, handelsgelijkvloers, common circulation, INPANDIGE terrassen at full rate); cat2 = garage/parking/kelder/berging/techniek/zolder onafgewerkt (a row on a 'Parkeerkelder' niveau is cat2 even if labeled generically); cat3 = terras/balkon/dakterras; other = groendak/zonnepanelen/lift/buitenaanleg/vetustiteit/afbraak.
If a row is in m³ (Hauteur ≠ 0), divide volume by hoogte to get floor-equivalent m² and report that in opp_m2, with hoogte_m filled.
Belgian numbers: 1.657,60 → 1657.60. Do not invent rows.
Return JSON: {"rows":[{"omschrijving","niveau","opp_m2","hoogte_m","cat"}],"total_eur":<n|null>}`;

function findPdf(ref) {
  const digits = ref.replace("-", "");
  for (const d of DIRS) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d).find((f) => f.startsWith(ref) || f.replace("-", "").startsWith(digits));
    if (hit) return join(d, hit);
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const ref of refs) {
  if (gtOut[ref]) { console.log(ref, "al geoogst, skip"); continue; }
  const pdf = findPdf(ref);
  if (!pdf) { console.log(ref, "PDF niet gevonden"); continue; }
  try {
    let txt = "";
    try { txt = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 2e8 }); } catch { /* */ }
    const pages = txt.split("\f");
    const idx = [];
    pages.forEach((p, i) => { if (TABLE_RE.test(p)) idx.push(i); });
    if (!idx.length) { console.log(ref, "geen tabelpagina gevonden"); continue; }
    const doc = mupdf.Document.openDocument(readFileSync(pdf), "application/pdf");
    const imgs = [];
    for (const i of idx.slice(0, 6)) {
      const page = doc.loadPage(i);
      const pix = page.toPixmap(mupdf.Matrix.scale(165 / 72, 165 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      let png = Buffer.from(pix.asPNG());
      if (png.length > 3.2e6) png = await sharp(png).resize({ width: 1568, fit: "inside" }).png().toBuffer();
      imgs.push(png.toString("base64"));
    }
    const content = [{ type: "text", text: INSTR }, ...imgs.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
    let j = null;
    for (let a = 0; a < 4; a++) {
      try {
        const msg = await client.messages.create({ model: MODEL, max_tokens: 8000, system: SYS, messages: [{ role: "user", content }] });
        if (msg.stop_reason === "refusal") throw new Error("refusal");
        const m = (msg.content.find((b) => b.type === "text")?.text || "").match(/\{[\s\S]*\}/);
        j = m ? JSON.parse(m[0]) : null;
        break;
      } catch (e) {
        if (e?.status === 429 || e?.status >= 500) { await sleep(6000 * (a + 1)); continue; }
        throw e;
      }
    }
    if (!j?.rows?.length) { console.log(ref, "geen rijen"); continue; }
    const sum = { cat1: 0, cat2: 0, cat3: 0 };
    for (const r of j.rows) if (r.opp_m2 && sum[r.cat] !== undefined) sum[r.cat] += r.opp_m2;
    gtOut[ref] = { cat1_m2: +sum.cat1.toFixed(1), cat2_m2: +sum.cat2.toFixed(1), cat3_m2: +sum.cat3.toFixed(1), total_eur: j.total_eur || null, rows: j.rows, tablePages: idx.slice(0, 6), source: MODEL };
    writeFileSync(OUTFILE, JSON.stringify(gtOut, null, 1));
    console.log(ref, `cat1=${sum.cat1.toFixed(0)} cat2=${sum.cat2.toFixed(0)} cat3=${sum.cat3.toFixed(0)} (${j.rows.length} rijen)`);
    await sleep(1200);
  } catch (e) {
    console.log(ref, "FOUT:", String(e.message || e).slice(0, 120));
  }
}
console.log("klaar:", Object.keys(gtOut).length, "refs in gt-auto.json");
