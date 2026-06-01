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

// args: node test-qqp-live.mjs <pdfpath> <pageIdxCsv> <requiredF?>
const PLAN = process.argv[2] || "C:/Users/tieme/Desktop/testing 30_5/25-542077plan.pdf";
const PAGE_IDX = (process.argv[3] || "2,3,4").split(",").map(Number);
const REQUIRED_F = process.argv[4] ? Number(process.argv[4]) : 1.49;

// LIVE guides = the actual reference-ranges.ts promptGuides (house-calibrated, absence-negative).
// This is what the LIVE pipeline feeds with prompt v1 + intercept 1.2824.
const LIVE_GUIDES = {
  total_livable_sqm: "<60=-1,100=-0.5,150=0,220=+0.5,300+=+1", entrance_hall_sqm: "<2=-1,4=-0.5,6=0,10=+0.5,15+=+1",
  living_room_sqm: "<15=-1,25=-0.5,35=0,50=+0.5,70+=+1", kitchen_sqm: "<5=-1,8=-0.5,10=0,15=+0.5,20+=+1; kitchenette=-1",
  master_bedroom_sqm: "<9=-1,12=-0.5,15=0,20=+0.5,28+=+1", avg_bedroom_sqm: "<8=-1,10=-0.5,12=0,16=+0.5,22+=+1",
  largest_bathroom_sqm: "<3=-1,5=-0.5,7=0,10=+0.5,15+=+1; only small shower(<3)=-1", garage_sqm: "none=-0.5,15=0,25=+0.3,40=+0.7,60+=+1",
  terrace_balcony_sqm: "none=-0.5,5=-0.2,15=0,30=+0.5,50+=+1", circulation_ratio: "<5%=-1,10%=-0.5,15%=0,20%=+0.5,30%+=+1",
  floor_count: "1=-0.3,2=0,3=+0.3,4+=+0.7", bedroom_count: "1=-0.5,2=-0.2,3=0,4=+0.3,5+=+0.7",
  bathroom_count: "1=-0.5,1.5=0,2=+0.3,3=+0.7,4+=+1", toilet_count: "1=-0.3,2=0,3=+0.5,4+=+1",
  bathroom_per_bedroom_ratio: "0.3=-1,0.5=-0.3,0.67=0,0.8=+0.5,1.0+=+1", has_separate_dining: "absent=0,present=+0.5",
  has_office: "absent=0,office=+0.5", has_dressing: "absent+small bedrooms=-0.5, absent+spacious=0, present=+0.7, large=+1",
  has_laundry_room: "absent=0,present=+0.5", has_wellness: "absent=0,sauna/pool/spa=+0.8", has_basement: "absent=0,present=+0.3",
  has_garage: "absent=0,present=+0.3", kitchen_appliance_count: "0=-1,2=-0.3,4=0,6=+0.5,8+=+1",
  has_kitchen_island: "absent=0,present=+0.6", bathroom_luxury_score: "1=-1,3=-0.3,5=0,7=+0.5,10=+1",
  has_fireplace: "absent=0,present=+0.5", has_open_kitchen: "closed=0,open=+0.4", built_in_storage_count: "0=-0.5,2=0,4=+0.3,6=+0.6,10+=+1",
  living_to_total_ratio: "15%=-0.5,20%=0,25%=+0.3,35%=0,50%=-0.3", wet_room_to_total_ratio: "10%=-0.5,15%=0,20%=+0.3,25%=+0.6,35%+=+1",
  outdoor_to_indoor_ratio: "0=-0.5,5%=0,10%=+0.3,20%=+0.6,35%+=+1", avg_room_size: "10=-1,14=-0.5,18=0,24=+0.5,32+=+1",
};

// APT guides = de-biased apartment-anchored (for staged v2; pairs with re-calibrated intercept)
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

const SQM_CONTEXT = process.env.QQP_CONTEXT || `Building: DIE PRINCE, Oostende zeedijk. High-end. (default context)`;

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

async function runQQP(system, guideMap) {
  const guidesText = QQP_NAMES.map((q) => `- ${q}: ${guideMap[q] || "average=0"}`).join("\n");
  const content = [
    { type: "text", text: `Score each QQP for this APARTMENT building's typical unit (-1.0..+1.0, 0=average). Use the plan IMAGES + context.\n\nCONTEXT:\n${SQM_CONTEXT}\n\nQQPs + guides:\n${guidesText}\n\nReturn ONLY JSON: {"qqp_values":{"name":{"score":0.0}}}` },
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
const predictF = (s, intercept) => clamp(Object.entries(s).reduce((f, [q, v]) => f + (W[q] ?? 0) * v, intercept));
const price = (f) => Math.round(1600 + (f - F_MIN) / (F_MAX - F_MIN) * 1300);

// v1 = TRUE LIVE: biased prompt + house-calibrated guides + intercept 1.2824
// v2 = PROPOSED: apartment prompt + de-biased guides + re-calibrated intercept 0.93
const RUNS = [
  ["LIVE  (v1 prompt + huis-guides + int 1.2824)", v1, LIVE_GUIDES, INTERCEPT],
  ["v2    (apt prompt + apt-guides + int 0.93)", v2, GUIDES, 0.93],
];
for (const [label, sys, guides, intercept] of RUNS) {
  try {
    const s = await runQQP(sys, guides);
    const mean = Object.values(s).reduce((a, b) => a + b, 0) / Object.keys(s).length;
    const f = predictF(s, intercept);
    const top = Object.entries(s).filter(([k]) => (W[k] ?? 0) > 0.03).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`── ${label} ──`);
    console.log(`  score-gem ${mean.toFixed(2)}  →  F=${f.toFixed(2)}  →  cat1 €${price(f)}/m²`);
    console.log(`  top QQPs: ${top.map(([k, v]) => `${k}=${v.toFixed(1)}`).join(", ")}`);
    if (REQUIRED_F) console.log(`  vereiste F=${REQUIRED_F} (€${price(REQUIRED_F)}). Δ cat1 = ${Math.round((price(f) / price(REQUIRED_F) - 1) * 100)}%`);
    console.log("");
  } catch (e) { console.log(`── ${label} ──\n  FOUT: ${e.message}\n`); }
}
console.log("cat1 €1600(F0.70)–€2900(F1.50). LIVE int 1.2824, v2 int 0.93.");
