/**
 * sqm-planonly.mjs — test the universal extractor on REAL architect plan files
 * (production-realistic: customer uploads just the plan, no berekening).
 * Renders ALL plan pages (these PDFs are plan-only), one vision call, compares to GT.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
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
const DIR = "C:/Users/tieme/Desktop/testing 30_5";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TESTS = [
  { file: "25-5420420plan.pdf", ref: "25-542042", heated: 652 },
  { file: "25-542077plan.pdf", ref: "25-542077", heated: 2009 },
  { file: "25-54628700plan.pdf", ref: "25-546287", heated: 2419 },
];

const SYS = `You analyze Belgian building floor plans (vergunningsplan / architect plan) to extract floor areas. You report EVERY area number PRINTED on the plan; only measure from dimension lines as a last resort. Return ONLY JSON.`;
const INSTR = `These images are ALL the FLOOR PLANS of ONE building project (every floor/sheet). Get the building's floor areas. Belgian plans usually PRINT areas — read them, don't estimate.
Priority: (1) an area schedule/oppervlaktetabel printed on the sheet → transcribe every row; (2) per-unit net labels ("Opp.: 74,76 m²","BO 104,3 m²"); (3) per-room labels; (4) a stated total. Only if NONE exist: measure from dimensions.
Count each unit/room ONCE across sheets. Belgian numbers 1.234,56→1234.56.
Return JSON:
{"has_area_schedule":<bool>,"schedule_rows":[{"label":"...","level":"...","m2":<n>}],"unit_labels":[{"label":"...","level":"...","net_m2":<n>}],"room_labels":[{"room":"...","level":"...","m2":<n>}],"stated_total_m2":<n|null>,"measured_gross_m2":<n|null>,"n_floors_seen":<int>,"building_type":"...","confidence":<0..1>,"notes":"..."}`;

async function renderAll(buf) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages();
  const out = [];
  for (let i = 0; i < Math.min(total, 8); i++) {
    try {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(170 / 72, 170 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      let png = Buffer.from(pix.asPNG()), width = pix.getWidth();
      while (png.length > 2_800_000 && width > 1500) { width = Math.floor(width * 0.82); png = await sharp(Buffer.from(pix.asPNG())).resize({ width }).png().toBuffer(); }
      if (png.length <= 3_400_000) out.push(png.toString("base64"));
    } catch { /* skip */ }
  }
  return out;
}
async function extract(images) {
  await sleep(1200);
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYS, messages: [{ role: "user", content }] }) });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
  const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}
function isHeated(desc) {
  const d = (desc || "").toLowerCase();
  if (!d.trim()) return false;
  if (/terras|balkon|dakterras|groendak/.test(d)) return false;
  if (/kelder|garage|berging|parking|staanplaats|techni|inrit|hellingsbaan|liften?\b|stalling/.test(d)) return false;
  if (/zonnepane|buitenaanleg|vetuste?it|fotovolta/.test(d)) return false;
  return true;
}

for (const t of TESTS) {
  try {
    const buf = readFileSync(`${DIR}/${t.file}`);
    const r = await extract(await renderAll(buf));
    if (!r) { console.log(`${t.ref}: geen extractie`); continue; }
    const sched = (r.schedule_rows || []).filter((x) => isHeated(x.label)).reduce((s, x) => s + (+x.m2 || 0), 0);
    const unitNet = (r.unit_labels || []).reduce((s, x) => s + (+x.net_m2 || 0), 0);
    const roomSum = (r.room_labels || []).filter((x) => isHeated(x.room)).reduce((s, x) => s + (+x.m2 || 0), 0);
    const d = (v) => (v ? ((v / t.heated - 1) * 100).toFixed(0) + "%" : "—");
    console.log(`\n=== ${t.ref}  (heated GT ${t.heated} m²)  type=${r.building_type} conf=${r.confidence} floors=${r.n_floors_seen} ===`);
    console.log(`  schedule(${r.has_area_schedule?"yes":"no"}): ${Math.round(sched)} (${d(sched)}) | unitNet: ${Math.round(unitNet)} (${d(unitNet)}) n=${(r.unit_labels||[]).length} | room: ${Math.round(roomSum)} (${d(roomSum)}) | total: ${r.stated_total_m2||"—"} (${d(r.stated_total_m2)}) | measured: ${r.measured_gross_m2||"—"} (${d(r.measured_gross_m2)})`);
    console.log(`  notes: ${(r.notes || "").slice(0, 200)}`);
    if ((r.unit_labels||[]).length) console.log(`  units: ` + (r.unit_labels||[]).slice(0,12).map(u=>`${u.label}=${u.net_m2}`).join(", "));
    if ((r.schedule_rows||[]).length) console.log(`  sched rows: ` + (r.schedule_rows||[]).slice(0,12).map(u=>`${u.label}=${u.m2}`).join(", "));
  } catch (e) { console.log(`${t.ref}: FOUT ${String(e.message).slice(0,150)}`); }
}
