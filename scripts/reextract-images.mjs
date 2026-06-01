/**
 * reextract-images.mjs — IMAGE-BASED QQP re-extraction with the new apartment-
 * anchored prompt, to validate that discrimination returns WITH plan images
 * (text-only collapsed to ~0) and to measure the true new score mean → intercept.
 *
 * Per dossier: download plan PDF (Supabase storage), render pages (mupdf, 110 DPI),
 * pick the densest K pages (proxy for floor plans), call Anthropic with the new
 * system prompt + images + stored sqm_extraction, parse QQP scores.
 *
 * Run: node scripts/reextract-images.mjs [limit] [pagesPerDossier]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const AKEY = env.ANTHROPIC_API_KEY;
const LIMIT = parseInt(process.argv[2] || "15", 10);
const PAGES = parseInt(process.argv[3] || "4", 10);

const NEW_SYSTEM = `You are a Belgian building RECONSTRUCTION cost estimation expert. You assess the "finishing level" of APARTMENTS by scoring Quantitative-Qualitative Parameters (QQPs). The buildings are almost always APARTMENT buildings — calibrate every score to the AVERAGE BELGIAN NEW-BUILD APARTMENT, never to a house or villa.

SCORING SCALE: -1.0 to +1.0, anchored on the average apartment:
  -1.0 = Actively basic/cheap — a real downgrade is PRESENT
  -0.5 = Below the average apartment
   0.0 = AVERAGE Belgian new-build apartment (standard finish) — typical, DEFAULT case
  +0.5 = Above average / comfort
  +1.0 = Luxury / premium

THE AVERAGE APARTMENT (0.0): ~85-100 m² livable, 2 bedrooms, 1 bathroom, 1-2 toilets, standard fitted kitchen, normal ceiling height, NO wellness / NO dressing / NO fireplace. NORMAL — score 0.0, never negative.

PRESENCE vs ABSENCE (critical):
- POSITIVE only when genuinely ABOVE average (2nd bathroom, walk-in dressing, kitchen island, premium materials, generous rooms, extra toilet, large terrace).
- NEGATIVE only when a real DOWNGRADE is PRESENT (kitchenette not a real kitchen, single cramped shower room, sub-standard small rooms).
- ABSENCE of a premium feature is NEUTRAL (0.0), NOT negative.

USE THE PLAN IMAGES to judge visible finish quality (materials, kitchen layout, bathroom fixtures, room generosity). Your goal is RECONSTRUCTION cost, not real estate value.`;

const GUIDES = {
  total_livable_sqm: "apt unit: <50=-1, 70=-0.5, 90=0, 140=+0.5, 200+=+1",
  entrance_hall_sqm: "<2=-1, 3=-0.5, 5=0, 8=+0.5, 12+=+1",
  living_room_sqm: "<18=-1, 24=-0.5, 30=0, 42=+0.5, 55+=+1",
  kitchen_sqm: "<5=-1, 7=-0.5, 9=0, 13=+0.5, 18+=+1; kitchenette=-1",
  master_bedroom_sqm: "<9=-1, 11=-0.5, 13=0, 17=+0.5, 24+=+1",
  avg_bedroom_sqm: "<8=-1, 9.5=-0.5, 11=0, 14=+0.5, 19+=+1",
  largest_bathroom_sqm: "<3=-1, 4=-0.5, 6=0, 9=+0.5, 13+=+1",
  garage_sqm: "no private garage=0 (normal); box 15=+0.3, 25=+0.5, 40+=+0.8",
  terrace_balcony_sqm: "none=0 (normal); 6=+0.2, 12=+0.4, 25=+0.7, 40+=+1",
  circulation_ratio: "<8%=-0.5, 12%=0, 18%=+0.5, 25%+=+1",
  floor_count: "layers 2-3=0, 4-5=+0.2, 6-8=+0.4, 9+=+0.6",
  bedroom_count: "1=-0.3, 2=0, 3=+0.3, 4=+0.6, 5+=+0.9",
  bathroom_count: "1=0, 2=+0.5, 3=+0.8, 4+=+1",
  toilet_count: "1=-0.1, 2=+0.2, 3=+0.6, 4+=+1",
  bathroom_per_bedroom_ratio: "0.33=-0.3, 0.5=0, 0.67=+0.4, 1+=+1",
  has_separate_dining: "absent=0, separate dining=+0.5",
  has_office: "absent=0, office/study=+0.5",
  has_dressing: "absent=0 (normal), present=+0.7, large=+1",
  has_laundry_room: "absent=0, utility=+0.4",
  has_wellness: "absent=0 (normal), sauna/pool/spa=+0.8",
  has_basement: "absent=0, cellar=+0.3",
  has_garage: "absent=0 (normal), garage box=+0.3",
  kitchen_appliance_count: "standard=0; none=-1, basic=-0.3, well-equipped=+0.5, premium=+1",
  has_kitchen_island: "absent=0, island=+0.6",
  bathroom_luxury_score: "standard=0; basic shower only=-0.5, bath+shower=+0.4, jacuzzi/premium=+1",
  has_fireplace: "absent=0 (normal), present=+0.5",
  has_open_kitchen: "closed=0, open-plan=+0.4",
  built_in_storage_count: "none=0 (normal), some=+0.3, many=+0.6, extensive=+1",
  living_to_total_ratio: "20-30%=0, very low=-0.3, very high=-0.2",
  wet_room_to_total_ratio: "15%=0, 20%=+0.3, 25%+=+0.6",
  outdoor_to_indoor_ratio: "0=0, 10%=+0.3, 20%+=+0.6",
  avg_room_size: "<12=-0.5, 16=0, 22=+0.5, 30+=+1",
};
const guideFor = (q) => GUIDES[q] || "average apartment=0; negative only if real downgrade present";

const results = await (await fetch(`${U}/rest/v1/evaluation_results?select=dossier_id,extracted_qqps,sqm_extraction,predicted_f,created_at&order=created_at.desc`, { headers: H })).json();
const latest = {};
for (const r of results) { if (r.extracted_qqps && Object.keys(r.extracted_qqps).length && r.sqm_extraction && !latest[r.dossier_id]) latest[r.dossier_id] = r; }
const ids = Object.keys(latest).slice(0, LIMIT);
const rds = await (await fetch(`${U}/rest/v1/reference_dossiers?select=id,plan_storage_path,plan_file_name&id=in.(${ids.join(",")})`, { headers: H })).json();
const planById = {}; for (const d of rds) planById[d.id] = d;
const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=intercept,weights`, { headers: H })).json())[0];
const W = model.weights;

async function renderTopPages(path, k) {
  const dl = await fetch(`${U}/storage/v1/object/plans/${path}`, { headers: H });
  if (!dl.ok) throw new Error("download " + dl.status);
  const buf = Buffer.from(await dl.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const n = doc.countPages();
  const DPI = 72; // keep PNGs well under Anthropic's 5MB/image limit
  const mat = mupdf.Matrix.scale(DPI / 72, DPI / 72);
  const pages = [];
  for (let i = 0; i < n; i++) {
    try {
      const pix = doc.loadPage(i).toPixmap(mat, mupdf.ColorSpace.DeviceRGB, false, true);
      const b64 = Buffer.from(pix.asPNG()).toString("base64"); // FIX: Buffer.from before base64
      if (b64.length > 4_500_000) continue; // skip pages that are still too large
      pages.push({ i, b64, size: b64.length });
    } catch {}
  }
  // densest pages = likely floor plans
  return pages.sort((a, b) => b.size - a.size).slice(0, k).sort((a, b) => a.i - b.i);
}

async function scoreWithImages(sqmJson, qqpNames, pages) {
  const guidesText = qqpNames.map((q) => `- ${q}: ${guideFor(q)}`).join("\n");
  const content = [
    { type: "text", text: `Score each QQP for this APARTMENT (-1.0..+1.0, 0.0=average apt). Use the plan IMAGES + data.\n\nPLAN DATA:\n${JSON.stringify(sqmJson).slice(0, 6000)}\n\nQQPs + guides:\n${guidesText}\n\nAbsence of a premium feature = 0.0, not negative. Negative only if a real downgrade is present.\nReturn ONLY JSON: {"qqp_values":{"name":{"score":0.0}}}` },
    ...pages.map((p) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: p.b64 } })),
  ];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, system: NEW_SYSTEM, messages: [{ role: "user", content }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error("API " + JSON.stringify(j).slice(0, 150));
  const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]).qqp_values : null;
}

const F_MIN = 0.70, F_MAX = 1.50;
const clamp = (f) => Math.max(F_MIN, Math.min(F_MAX, f));
const predictF = (scores, intercept) => clamp(Object.entries(scores).reduce((f, [q, s]) => f + (W[q] ?? 0) * s, intercept));

console.log(`Beeld-gebaseerde her-extractie: ${ids.length} dossiers, ${PAGES} pagina's elk\n`);
const out = [], newMeans = [];
for (const id of ids) {
  const r = latest[id], plan = planById[id];
  if (!plan?.plan_storage_path) { console.log(`${id.slice(0,8)}: geen plan`); continue; }
  try {
    const pages = await renderTopPages(plan.plan_storage_path, PAGES);
    const oldScores = {}; for (const [k, v] of Object.entries(r.extracted_qqps)) if (typeof v?.score === "number") oldScores[k] = v.score;
    const raw = await scoreWithImages(r.sqm_extraction, Object.keys(oldScores), pages);
    if (!raw) { console.log(`${id.slice(0,8)}: geen JSON`); continue; }
    const newScores = {}; for (const [k, v] of Object.entries(raw)) if (typeof v?.score === "number") newScores[k] = v.score;
    const common = Object.keys(oldScores).filter((q) => q in newScores);
    const oldMean = common.reduce((a, q) => a + oldScores[q], 0) / common.length;
    const newMean = common.reduce((a, q) => a + newScores[q], 0) / common.length;
    newMeans.push(newMean);
    out.push({ id, oldScores, newScores });
    const fOld = predictF(oldScores, model.intercept);
    const fNew096 = predictF(newScores, 0.96);
    console.log(`${id.slice(0,8)}: score-gem ${oldMean.toFixed(2)}→${newMean.toFixed(2)}  | F: oud(int1.28)=${fOld.toFixed(2)} → nieuw(int0.96)=${fNew096.toFixed(2)}`);
  } catch (e) { console.log(`${id.slice(0,8)}: FOUT ${e.message}`); }
}

writeFileSync("scripts/reextract-images-out.json", JSON.stringify(out, null, 1));
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
console.log(`\n${"═".repeat(64)}`);
console.log(`Nieuwe score-gem (beeld): gemiddeld ${avg(newMeans).toFixed(3)}, spreiding (sd) ${sd(newMeans).toFixed(3)}, bereik ${Math.min(...newMeans).toFixed(2)}–${Math.max(...newMeans).toFixed(2)}`);
console.log(`→ Onderscheid ${sd(newMeans) > 0.10 ? "BEHOUDEN (sd>0.10) ✓" : "nog steeds vlak (sd≤0.10) ⚠"}`);
console.log(`Resultaten opgeslagen → scripts/reextract-images-out.json`);
