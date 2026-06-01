/**
 * sqm-universal.mjs — characterize WHICH SQM signal is available per dossier and how
 * accurate each is, on the PLAN PAGES ONLY (production-realistic: customer uploads the
 * plan, not the berekening). One vision call per dossier returns every available signal:
 *   - on-plan area schedule (oppervlaktetabel printed on the plan sheet) → exact
 *   - per-unit net labels (Opp/BO m²) → sum × gross factor
 *   - per-room labels → sum
 *   - stated total m²
 *   - measured gross (from dimensions) — fallback only
 * Compares each to heated_m2 GT so we can pick the best method per input type.
 *
 * Usage: node scripts/sqm-universal.mjs [maxDossiers]
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
const MODEL = "claude-sonnet-4-6";
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX = parseInt(process.argv[2] || "99", 10);

// Files in the selectie folder, matched to GT refs that have a real heated floor.
import { readdirSync } from "node:fs";
const files = readdirSync(DIR).filter((f) => /VerzamelPDF.*\.pdf$/i.test(f) && !/kopie/i.test(f));
const work = files
  .map((f) => ({ f, ref: (f.match(/^(\d{2}-\d{6})/) || [])[1] }))
  .filter((x) => x.ref && gt[x.ref] && gt[x.ref].heated_m2 > 0)
  .slice(0, MAX);

const SYS = `You analyze Belgian building floor plans (vergunningsplan / architect plan) to extract floor areas. You report EVERY area number that is PRINTED on the plan, and only measure from dimension lines as a last resort. Return ONLY JSON.`;

const INSTR = `These images are the FLOOR PLANS of ONE building project (possibly multiple floors/sheets). Your job: get the building's floor areas. Belgian plans usually PRINT the areas — read them, do not estimate.

Look for, in priority order:
1. An AREA SCHEDULE / oppervlaktetabel printed on the sheet: a table listing units or floors with their m² (columns like "Opp", "Oppervlakte", "BVO", "m²"). If present, transcribe EVERY row.
2. Per-unit NET area labels on each dwelling ("Opp.: 74,76 m²", "BO 104,3 m²", "app 0.3A … 104,3 m²").
3. Per-room area labels ("Leefruimte 32,4 m²", "Slaapkamer 14 m²").
4. A stated TOTAL ("Totale oppervlakte … m²", "BVO totaal …").
Only if NONE of the above exist: measure the gross floor from dimension lines.

Count each unit/room ONCE even if it appears on multiple sheets. Belgian numbers: 1.234,56 → 1234.56.

Return JSON:
{
 "has_area_schedule": <bool>,
 "schedule_rows": [{"label":"...", "level":"...", "m2":<number>}],
 "unit_labels":    [{"label":"...", "level":"...", "net_m2":<number>}],
 "room_labels":    [{"room":"...",  "level":"...", "m2":<number>}],
 "stated_total_m2": <number or null>,
 "measured_gross_m2": <number or null>,
 "n_floors_seen": <int>,
 "building_type": "appartementsgebouw|woning|winkel|...",
 "confidence": <0..1>,
 "notes": "what signal you used, what was unclear"
}`;

function planPages(file) {
  // pages with floor-plan keyword density, EXCLUDING berekening + notarial-deed +
  // CED/expertise-report pages (the VerzamelPDF bundles all of these together).
  let t = "";
  try { t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 }); } catch { return []; }
  const pages = t.split("\f");
  const planKw = /slaapkamer|leefruimte|badkamer|keuken|terras|berging|inkomhal|traphal|nachthal|dressing|bureau|woonkamer|living|nachthal|gevel|snede|grondplan|schaal\s*1/gi;
  // pages that are NOT architect plans: berekening, notarial deed, CED/insurer report
  const junkKw = /Totaal kapitaal in nieuwbouwwaarde|NIEUWBOUWWAARDE\s+INCLUSIEF|vetustiteit|verzekerd kapitaal|\bBLAD\b|notari|proces-verbaal|\bakte\b|expertise|CED\b|AXA|schadegeval|hypothe|kadastr/i;
  const scored = pages.map((p, i) => {
    const words = (p.match(/\S+/g) || []).length;
    return { i, n: (p.match(planKw) || []).length, junk: junkKw.test(p), words };
  });
  // real plan sheets: decent plan-keyword count, not junk, not a wall of text (deeds are text-heavy)
  let plans = scored.filter((s) => s.n >= 5 && !s.junk).sort((a, b) => b.n - a.n).slice(0, 6).map((s) => s.i);
  if (!plans.length) plans = scored.filter((s) => s.n >= 3 && !s.junk).sort((a, b) => b.n - a.n).slice(0, 6).map((s) => s.i);
  if (!plans.length) plans = scored.filter((s) => !s.junk && s.words < 120).slice(0, 6).map((s) => s.i); // image-only CAD
  return plans.sort((a, b) => a - b);
}

async function render(buf, idx) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages();
  const out = [];
  for (const i of idx) {
    if (i < 0 || i >= total) continue;
    try {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(160 / 72, 160 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      let png = Buffer.from(pix.asPNG()), width = pix.getWidth();
      while (png.length > 2_800_000 && width > 1500) { width = Math.floor(width * 0.82); png = await sharp(Buffer.from(pix.asPNG())).resize({ width }).png().toBuffer(); }
      if (png.length <= 3_400_000) out.push(png.toString("base64"));
    } catch { /* skip */ }
  }
  return out;
}

async function extract(images) {
  await sleep(1300);
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYS, messages: [{ role: "user", content }] }),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
      const j = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
      const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(3000 * (attempt + 1));
    }
  }
  return null;
}

// classify a row into heated cat1 vs cat2/cat3/other (mirror sqm-router classifyAreaRow)
function isHeated(desc) {
  const d = (desc || "").toLowerCase();
  if (!d.trim()) return false;
  if (/terras|balkon|dakterras|groendak|gras\b/.test(d)) return false;
  if (/kelder|garage|berging|parking|staanplaats|fietsberg|afvalberg|techni|inrit|hellingsbaan|liften?\b|sprinkler|vuilnis|afval|stalling|loods/.test(d)) return false;
  if (/zonnepane|lift(installatie)?|buitenaanleg|vetuste?it|energieprestatie|fotovolta|warmtepomp|domotica/.test(d)) return false;
  return true;
}

const out = [];
console.error(`== sqm-universal: ${work.length} dossiers ==`);
for (const { f, ref } of work) {
  try {
    const buf = readFileSync(join(DIR, f));
    const pages = planPages(f);
    const imgs = await render(buf, pages);
    if (!imgs.length) { console.error(`${ref}: geen plan-paginas`); continue; }
    const r = await extract(imgs);
    if (!r) { console.error(`${ref}: geen extractie`); continue; }

    const schedHeated = (r.schedule_rows || []).filter((x) => isHeated(x.label)).reduce((s, x) => s + (+x.m2 || 0), 0);
    const unitNet = (r.unit_labels || []).reduce((s, x) => s + (+x.net_m2 || 0), 0);
    const roomSum = (r.room_labels || []).reduce((s, x) => s + (+x.m2 || 0), 0);
    const heated = gt[ref].heated_m2;

    out.push({
      ref, type: r.building_type, conf: r.confidence,
      has_schedule: !!r.has_area_schedule,
      sched: Math.round(schedHeated), unitNet: Math.round(unitNet), roomSum: Math.round(roomSum),
      total: r.stated_total_m2 || null, measured: r.measured_gross_m2 || null,
      n_units: (r.unit_labels || []).length, n_floors: r.n_floors_seen,
      heated, notes: (r.notes || "").slice(0, 120),
    });
    const dPct = (v) => (v ? ((v / heated - 1) * 100).toFixed(0) + "%" : "—");
    console.error(`${ref.padEnd(11)} heated ${String(heated).padStart(6)} | sched ${String(Math.round(schedHeated)).padStart(6)} ${dPct(schedHeated).padStart(5)} | unitNet ${String(Math.round(unitNet)).padStart(6)} ${dPct(unitNet).padStart(5)} | room ${dPct(roomSum).padStart(5)} | total ${dPct(r.stated_total_m2).padStart(5)} | meas ${dPct(r.measured_gross_m2).padStart(5)} | ${r.has_area_schedule ? "SCHED" : ""}`);
    writeFileSync("scripts/sqm-universal.json", JSON.stringify(out, null, 1));
  } catch (e) {
    console.error(`${ref}: FOUT ${String(e.message).slice(0, 120)}`);
  }
}

writeFileSync("scripts/sqm-universal.json", JSON.stringify(out, null, 1));
console.error(`\nKLAAR — ${out.length} dossiers → scripts/sqm-universal.json`);
