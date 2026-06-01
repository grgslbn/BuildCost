/**
 * test-dieprince-live.mjs — does the QQP extraction pick up Die Prince's luxe?
 * Renders the apartment floor plans from the local plan PDF, runs QQP extraction
 * with BOTH the live prompt (v1, biased) and the staged v2 (apartment-anchored),
 * computes F under the live model (intercept 1.2824), and compares to the
 * required F = 1.49 (expert woon €2880).
 */
import { readFileSync } from "node:fs";
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

const PLAN = "C:/Users/tieme/Desktop/testing 30_5/25-542077plan.pdf";
// apartment-detail floor pages (0-indexed): +5/+6, +3/+4, +7/+8/+9 → mupdf pages 3,4,2
const PAGE_IDX = [2, 3, 4];

// QQP names + apartment guides (same as staged set)
const GUIDES = {
  total_livable_sqm: "apt: <50=-1,70=-0.5,90=0,140=+0.5,200+=+1", bedroom_count: "1=-0.3,2=0,3=+0.3,4=+0.6",
  bathroom_count: "1=0,2=+0.5,3=+0.8,4+=+1", toilet_count: "1=-0.1,2=+0.2,3=+0.6", kitchen_sqm: "<5=-1,7=-0.5,9=0,13=+0.5,18+=+1; kitchenette=-1",
  living_room_sqm: "<18=-1,24=-0.5,30=0,42=+0.5,55+=+1", master_bedroom_sqm: "<9=-1,11=-0.5,13=0,17=+0.5,24+=+1",
  avg_bedroom_sqm: "<8=-1,9.5=-0.5,11=0,14=+0.5,19+=+1", largest_bathroom_sqm: "<3=-1,4=-0.5,6=0,9=+0.5,13+=+1",
  bathroom_luxury_score: "standard=0; basic shower=-0.5, bath+shower=+0.4, jacuzzi/double sink=+1",
  bathroom_per_bedroom_ratio: "0.33=-0.3,0.5=0,0.67=+0.4,1+=+1", kitchen_appliance_count: "standard=0; none=-1, well-equipped=+0.5, premium=+1",
  has_kitchen_island: "absent=0, island=+0.6", has_open_kitchen: "closed=0, open=+0.4", has_fireplace: "absent=0, present=+0.5",
  has_dressing: "absent=0, present=+0.7, large walk-in=+1", has_wellness: "absent=0, sauna/spa=+0.8",
  has_separate_dining: "absent=0, separate=+0.5", has_office: "absent=0, office=+0.5", has_laundry_room: "absent=0, utility=+0.4",
  has_basement: "absent=0, cellar=+0.3", has_garage: "absent=0, garage=+0.3", built_in_storage_count: "none=0, some=+0.3, many=+0.6, extensive=+1",
  entrance_hall_sqm: "<2=-1,3=-0.5,5=0,8=+0.5,12+=+1", circulation_ratio: "<8%=-0.5,12%=0,18%=+0.5", terrace_balcony_sqm: "none=0,12=+0.4,25=+0.7,40+=+1",
  garage_sqm: "none=0,box15=+0.3,25=+0.5,40+=+0.8", floor_count: "2-3=0,4-5=+0.2,6-8=+0.4,9+=+0.6",
  living_to_total_ratio: "20-30%=0", wet_room_to_total_ratio: "15%=0,20%=+0.3,25%+=+0.6", outdoor_to_indoor_ratio: "0=0,10%=+0.3,20%+=+0.6", avg_room_size: "<12=-0.5,16=0,22=+0.5,30+=+1",
};

const SQM_CONTEXT = `Building: DIE PRINCE, Albert I-Promenade 41 / Vlaanderenstraat 78, 8400 Oostende (zeedijk corner).
High-end apartment building, 9 levels + basement. Per typical floor: 2 apartments (A ~104.3 m², B ~102.9 m²).
Each apartment: leefruimte (living) ~45-48 m², open keuken ~12 m² (maatkeuken), 2 slaapkamers (~12-18 m²),
1-2 badkamers, dressing, terras (sea-facing) 7.7-14.3 m². Floor 8: 111.7 m². Penthouse duplex 116.1 m².
Facade: architectonisch beton + parement. Lift, zonnepanelen, groendak. "Hoger segment, betere afwerking."`;

// fetch live model + both prompts
const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=intercept,weights`, { headers: H })).json())[0];
const W = model.weights, INTERCEPT = model.intercept;
const prompts = await (await fetch(`${U}/rest/v1/prompt_versions?prompt_type=eq.qqp_extraction&select=version_number,system_prompt`, { headers: H })).json();
const v1 = prompts.find((p) => p.version_number === 1).system_prompt;
const v2 = prompts.find((p) => p.version_number === 2).system_prompt;

// render apartment pages
const buf = readFileSync(PLAN);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const mat = mupdf.Matrix.scale(72 / 72, 72 / 72);
const images = [];
for (const i of PAGE_IDX) {
  if (i >= doc.countPages()) continue;
  const b64 = Buffer.from(doc.loadPage(i).toPixmap(mat, mupdf.ColorSpace.DeviceRGB, false, true).asPNG()).toString("base64");
  if (b64.length < 4_500_000) images.push(b64);
}
console.log(`Gerenderd: ${images.length} appartement-plan pagina's\n`);

const QQP_NAMES = Object.keys(W).filter((k) => !k.startsWith("_"));
const guidesText = QQP_NAMES.map((q) => `- ${q}: ${GUIDES[q] || "average apt=0"}`).join("\n");

async function runQQP(system) {
  const content = [
    { type: "text", text: `Score each QQP for this APARTMENT building's typical unit (-1.0..+1.0, 0=average apt). Use the plan IMAGES + context.\n\nCONTEXT:\n${SQM_CONTEXT}\n\nQQPs + guides:\n${guidesText}\n\nReturn ONLY JSON: {"qqp_values":{"name":{"score":0.0}}}` },
    ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } })),
  ];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, system, messages: [{ role: "user", content }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 200));
  const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
  const raw = m ? JSON.parse(m[0]).qqp_values : {};
  const scores = {}; for (const [k, v] of Object.entries(raw)) if (typeof v?.score === "number") scores[k] = v.score;
  return scores;
}

const F_MIN = 0.70, F_MAX = 1.50;
const clamp = (f) => Math.max(F_MIN, Math.min(F_MAX, f));
const predictF = (s) => clamp(Object.entries(s).reduce((f, [q, v]) => f + (W[q] ?? 0) * v, INTERCEPT));
const price = (f) => Math.round(1600 + (f - F_MIN) / (F_MAX - F_MIN) * 1300);

for (const [label, sys] of [["LIVE prompt v1 (biased)", v1], ["STAGED prompt v2 (apartment-anchored)", v2]]) {
  try {
    const s = await runQQP(sys);
    const mean = Object.values(s).reduce((a, b) => a + b, 0) / Object.keys(s).length;
    const f = predictF(s);
    const top = Object.entries(s).filter(([k]) => (W[k] ?? 0) > 0.03).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`── ${label} ──`);
    console.log(`  score-gem ${mean.toFixed(2)}  →  F=${f.toFixed(2)}  →  cat1 €${price(f)}/m²`);
    console.log(`  top luxe-QQPs: ${top.map(([k, v]) => `${k}=${v.toFixed(1)}`).join(", ")}`);
    console.log(`  vs expert: vereiste F=1.49 (€2880). Δ cat1 = ${Math.round((price(f) / 2880 - 1) * 100)}%\n`);
  } catch (e) { console.log(`── ${label} ──\n  FOUT: ${e.message}\n`); }
}
console.log("Live model: intercept", INTERCEPT, "| Expert woon €2880 → F 1.49 | cat1 cap €2900 (F 1.50)");
