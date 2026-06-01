/**
 * sqm-vision-test.mjs — test the UNIFIED vision extractor (mirrors vision-extract.ts)
 * on: (a) the 3 production plan files (bare/labeled), (b) CED berekening pages (table).
 * Confirms: correct categorization (terras→cat3), area_table exactness, honest confidence.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
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
const PLANDIR = "C:/Users/tieme/Desktop/testing 30_5";
const CEDDIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYS = "You extract building floor areas (m²) from Belgian building documents — architect floor plans, JPEG photos of plans, or reconstruction-cost tables (berekening / oppervlaktestaat / meetstaat). You PREFER printed numbers over measuring. You categorize every area and you are honest about uncertainty. Return ONLY JSON.";
const INSTR = `Look at ALL the images (they are one building project). Determine the BEST available area signal and report it.
STEP 1 — Is there an AREA TABLE / berekening / oppervlaktestaat / meetstaat (a table of descriptions + m² + often € values, columns "Opp","Oppervlakte incl. btw","Opp/inhoud","BVO")? → If YES: "kind":"area_table", transcribe EVERY row.
STEP 2 — Else, do units/rooms carry PRINTED m² labels ("Opp.: 74,76 m²","BO 104,3 m²","Leefruimte 32 m²")? → If YES: "kind":"labeled_plan", list every labeled area (count once across sheets).
STEP 3 — Else (only dimensions): "kind":"bare_plan", measure gross floor per level, low confidence.
CATEGORIZE each row "cat": cat1=HEATED/LIVING/FINISHED (apartments, houses, offices, shops, common circulation/gemene delen/traphal/inkomhal); cat2=ENCLOSED UNHEATED (garage,parking,kelder,berging,techniek,fietsberging); cat3=OUTDOOR BUILT (terras,balkon,dakterras,groendak); other=NOT floor (zonnepanelen,lift,buitenaanleg,vetustiteit).
Belgian numbers 1.234,56→1234.56. Count each area ONCE.
Return JSON: {"kind":"...","building_type":"...","rows":[{"label":"...","level":"...","m2":<n>,"cat":"cat1|cat2|cat3|other"}],"cat1_m2":<n>,"cat2_m2":<n>,"cat3_m2":<n>,"stated_total_m2":<n|null>,"confidence":<0..1>,"notes":"..."}
confidence: area_table fully read ≥0.9; labeled_plan complete ~0.6; partial ~0.4; bare_plan measured ≤0.35.`;

async function renderPages(buf, idx, dpi = 170) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages();
  const out = [];
  for (const i of idx) {
    if (i < 0 || i >= total) continue;
    try {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      let png = Buffer.from(pix.asPNG()), w = pix.getWidth();
      while (png.length > 2_800_000 && w > 1500) { w = Math.floor(w * 0.82); png = await sharp(Buffer.from(pix.asPNG())).resize({ width: w }).png().toBuffer(); }
      if (png.length <= 3_400_000) out.push(png.toString("base64"));
    } catch { /* skip */ }
  }
  return out;
}
async function vision(images) {
  await sleep(1200);
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 4500, system: SYS, messages: [{ role: "user", content }] }) });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
  const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}
function assemble(d) {
  const rows = Array.isArray(d.rows) ? d.rows.map((r) => ({ label: r.label || "", m2: +r.m2 || 0, cat: ["cat1", "cat2", "cat3", "other"].includes(r.cat) ? r.cat : "other" })) : [];
  const sum = (c) => rows.filter((r) => r.cat === c).reduce((s, r) => s + (r.m2 > 0 ? r.m2 : 0), 0);
  const pick = (p, f) => ((+p || 0) > 0 ? +p : f);
  return { kind: d.kind, cat1: pick(d.cat1_m2, sum("cat1")), cat2: pick(d.cat2_m2, sum("cat2")), cat3: pick(d.cat3_m2, sum("cat3")), total: d.stated_total_m2 || null, conf: d.confidence, type: d.building_type, notes: d.notes, rows };
}

const PLAN_TESTS = [
  { file: "25-5420420plan.pdf", ref: "25-542042", heated: 652, pages: [0, 1, 2, 3] },
  { file: "25-542077plan.pdf", ref: "25-542077", heated: 2009, pages: [0, 1, 2, 3, 4, 5] },
  { file: "25-54628700plan.pdf", ref: "25-546287", heated: 2419, pages: [0, 1, 2, 3, 4, 5] },
];

function cedTablePages(file) {
  let t = ""; try { t = execSync(`pdftotext -layout "${join(CEDDIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 }); } catch { return [3, 4, 5, 6, 7]; }
  const pages = t.split("\f");
  const hit = [];
  pages.forEach((p, i) => { if (/Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl/i.test(p)) hit.push(i); });
  return hit.length ? [...new Set(hit)].slice(0, 5) : [3, 4, 5, 6, 7];
}
const CED_TESTS = [
  { file: "24-51940600064VerzamelPDF_20260504_2250.pdf", ref: "24-519406", heated: 5690 },
  { file: "25-53709200085VerzamelPDF_20260502_0306.pdf", ref: "25-537092", heated: 6244 },
  { file: "25-54628700066VerzamelPDF_20260426_2309.pdf", ref: "25-546287", heated: 2419 },
];

const d = (v, gt) => (v ? ((v / gt - 1) * 100).toFixed(0) + "%" : "—");

console.log("════ PLAN-ONLY (production: customer uploads the plan) ════");
for (const t of PLAN_TESTS) {
  try {
    const r = assemble(await vision(await renderPages(readFileSync(`${PLANDIR}/${t.file}`), t.pages)));
    console.log(`${t.ref} GT${t.heated}  kind=${r.kind} conf=${r.conf} | cat1=${Math.round(r.cat1)} (${d(r.cat1, t.heated)}) cat2=${Math.round(r.cat2)} cat3=${Math.round(r.cat3)} total=${r.total || "—"} | ${r.type}`);
    console.log(`   notes: ${(r.notes || "").slice(0, 150)}`);
  } catch (e) { console.log(`${t.ref}: FOUT ${String(e.message).slice(0, 120)}`); }
}
console.log("\n════ CED BEREKENING (insurer dossier with a table → should be area_table, exact) ════");
for (const t of CED_TESTS) {
  try {
    const pages = cedTablePages(t.file);
    const r = assemble(await vision(await renderPages(readFileSync(`${join(CEDDIR, t.file)}`), pages)));
    console.log(`${t.ref} GT${t.heated}  pages[${pages.join(",")}]  kind=${r.kind} conf=${r.conf} | cat1=${Math.round(r.cat1)} (${d(r.cat1, t.heated)}) cat2=${Math.round(r.cat2)} cat3=${Math.round(r.cat3)} | ${r.type}`);
  } catch (e) { console.log(`${t.ref}: FOUT ${String(e.message).slice(0, 120)}`); }
}
