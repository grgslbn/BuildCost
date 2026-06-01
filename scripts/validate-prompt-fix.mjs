/**
 * validate-prompt-fix.mjs — A/B test the apartment-anchored QQP prompt fix.
 *
 * Same input (stored sqm_extraction per dossier), two prompts:
 *   OLD = the stored extracted_qqps scores (house-anchored, absence=negative)
 *   NEW = fresh Anthropic call with the apartment-anchored, absence-neutral prompt
 *
 * Text-only (no images) — isolates the systematic scoring bias, which comes from
 * the prompt TEXT instructions, not the images. Reports the score-mean shift and
 * the resulting F (with current weights) so we can set the right intercept.
 *
 * Run: node scripts/validate-prompt-fix.mjs [limit]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const AKEY = env.ANTHROPIC_API_KEY;
const LIMIT = parseInt(process.argv[2] || "15", 10);

// ── NEW apartment-anchored, absence-neutral system prompt ────────────────────
const NEW_SYSTEM = `You are a Belgian building RECONSTRUCTION cost estimation expert. You assess the "finishing level" of APARTMENTS by scoring Quantitative-Qualitative Parameters (QQPs). The buildings you assess are almost always APARTMENT buildings — calibrate every score to the AVERAGE BELGIAN NEW-BUILD APARTMENT, never to a house or villa.

SCORING SCALE: -1.0 to +1.0, anchored on the average apartment:
  -1.0 = Actively basic/cheap — a real downgrade is PRESENT (below standard apartment finish)
  -0.5 = Below the average apartment
   0.0 = AVERAGE Belgian new-build apartment (standard finish) — the typical, DEFAULT case
  +0.5 = Above average / comfort
  +1.0 = Luxury / premium

THE AVERAGE APARTMENT (score 0.0): ~85-100 m² livable, 2 bedrooms, 1 bathroom, 1-2 toilets, a standard fitted kitchen, normal ceiling height, and NO wellness / NO dressing / NO fireplace. This is NORMAL — score it 0.0, never negative.

HOW TO SCORE PRESENCE vs ABSENCE (critical):
- POSITIVE (+) only when genuinely ABOVE the average apartment: 2nd bathroom, walk-in dressing, kitchen island, premium materials, generous rooms, extra toilet.
- NEGATIVE (−) only when a real DOWNGRADE is PRESENT: a kitchenette instead of a real kitchen, a single cramped shower room, clearly sub-standard rooms.
- The mere ABSENCE of a premium feature is NEUTRAL (0.0), NOT negative. Most apartments have no dressing / no wellness / no fireplace — that is the norm, so those = 0.0 when absent, POSITIVE only when present.

Your goal is RECONSTRUCTION cost estimation, not real estate value.`;

// apartment-calibrated one-line guides (absence-neutral; numerics re-anchored to apartments)
const GUIDES = {
  total_livable_sqm: "apartment unit: <50=-1.0, 70=-0.5, 90=0.0, 140=+0.5, 200+=+1.0",
  entrance_hall_sqm: "<2=-1.0, 3=-0.5, 5=0.0, 8=+0.5, 12+=+1.0",
  living_room_sqm: "<18=-1.0, 24=-0.5, 30=0.0, 42=+0.5, 55+=+1.0",
  kitchen_sqm: "<5=-1.0, 7=-0.5, 9=0.0, 13=+0.5, 18+=+1.0; kitchenette (not a real kitchen)=-1.0",
  master_bedroom_sqm: "<9=-1.0, 11=-0.5, 13=0.0, 17=+0.5, 24+=+1.0",
  avg_bedroom_sqm: "<8=-1.0, 9.5=-0.5, 11=0.0, 14=+0.5, 19+=+1.0",
  largest_bathroom_sqm: "<3=-1.0, 4=-0.5, 6=0.0, 9=+0.5, 13+=+1.0",
  garage_sqm: "apartment: no private garage is NORMAL=0.0; private box 15m²=+0.3, 25=+0.5, 40+=+0.8",
  terrace_balcony_sqm: "no terrace/balcony=0.0 (normal); 6=+0.2, 12=+0.4, 25=+0.7, 40+=+1.0",
  circulation_ratio: "<8%=-0.5, 12%=0.0, 18%=+0.5, 25%+=+1.0 (generous halls=higher)",
  floor_count: "building layers: 2-3=0.0, 4-5=+0.2, 6-8=+0.4, 9+=+0.6 (info only)",
  bedroom_count: "1=-0.3, 2=0.0 (average apt), 3=+0.3, 4=+0.6, 5+=+0.9",
  bathroom_count: "1=0.0 (average apt), 2=+0.5, 3=+0.8, 4+=+1.0",
  toilet_count: "1=-0.1, 2=+0.2, 3=+0.6, 4+=+1.0",
  bathroom_per_bedroom_ratio: "0.33=-0.3, 0.5=0.0, 0.67=+0.4, 1.0+=+1.0 (en-suite=high)",
  has_separate_dining: "absent=0.0, separate formal dining=+0.5",
  has_office: "absent=0.0, dedicated office/study=+0.5",
  has_dressing: "absent=0.0 (normal for apartments), present=+0.7, large walk-in=+1.0",
  has_laundry_room: "absent=0.0, dedicated laundry/utility=+0.4",
  has_wellness: "absent=0.0 (normal), present (sauna/pool/spa)=+0.8",
  has_basement: "absent=0.0, private cellar=+0.3",
  has_garage: "absent=0.0 (normal for apartments), private garage box=+0.3",
  kitchen_appliance_count: "standard fitted kitchen=0.0; 0/none=-1.0, basic=-0.3, well-equipped=+0.5, premium 8+=+1.0",
  has_kitchen_island: "absent=0.0, island present=+0.6",
  bathroom_luxury_score: "standard bath/shower=0.0; only basic shower=-0.5, bath+shower=+0.4, jacuzzi/double sink/premium=+1.0",
  has_fireplace: "absent=0.0 (normal), present=+0.5",
  has_open_kitchen: "closed kitchen=0.0, open-plan to living=+0.4",
  built_in_storage_count: "none=0.0 (normal), some built-ins=+0.3, many=+0.6, extensive=+1.0",
  living_to_total_ratio: "~20-30% is normal=0.0; very low=-0.3, very high=-0.2",
  wet_room_to_total_ratio: "~15%=0.0, 20%=+0.3, 25%+=+0.6",
  outdoor_to_indoor_ratio: "0=0.0 (normal), 10%=+0.3, 20%+=+0.6",
  avg_room_size: "<12=-0.5, 16=0.0, 22=+0.5, 30+=+1.0",
};
const guideFor = (q) => GUIDES[q] || "average apartment=0.0; below=negative only if a real downgrade is present; above=positive";

// ── Fetch data ───────────────────────────────────────────────────────────────
const results = await (await fetch(`${U}/rest/v1/evaluation_results?select=dossier_id,extracted_qqps,sqm_extraction,predicted_f,created_at&order=created_at.desc`, { headers: H })).json();
const latest = {};
for (const r of results) { if (r.extracted_qqps && Object.keys(r.extracted_qqps).length && r.sqm_extraction && !latest[r.dossier_id]) latest[r.dossier_id] = r; }
const dossiers = Object.entries(latest).slice(0, LIMIT);
const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=intercept,weights`, { headers: H })).json())[0];
const W = model.weights;

// ── Anthropic QQP call (text-only) ───────────────────────────────────────────
async function scoreQQPs(sqmJson, qqpNames) {
  const guidesText = qqpNames.map((q) => `- ${q}: ${guideFor(q)}`).join("\n");
  const user = `Score each QQP for this APARTMENT on a -1.0 to +1.0 scale, where 0.0 = average Belgian new-build apartment.

PLAN DATA (SQM extraction):
${JSON.stringify(sqmJson).slice(0, 8000)}

QQP PARAMETERS + apartment-calibrated guides:
${guidesText}

Remember: absence of a premium feature = 0.0 (not negative). Score negative ONLY when a real downgrade is present.
Return ONLY JSON: {"qqp_values":{"name":{"score":0.0}}}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, system: NEW_SYSTEM, messages: [{ role: "user", content: user }] }),
  });
  const j = await res.json();
  if (!res.ok) { console.error("API error:", JSON.stringify(j).slice(0, 200)); return null; }
  const txt = j.content?.[0]?.text || "";
  const m = txt.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]).qqp_values; } catch { return null; }
}

// ── Run A/B ──────────────────────────────────────────────────────────────────
const F_MIN = 0.70, F_MAX = 1.50;
const clamp = (f) => Math.max(F_MIN, Math.min(F_MAX, f));
const predictF = (scores, intercept) => clamp(Object.entries(scores).reduce((f, [q, s]) => f + (W[q] ?? 0) * s, intercept));

console.log(`A/B prompt-test op ${dossiers.length} dossiers (text-only)...\n`);
const oldMeans = [], newMeans = [], rows = [];
for (const [did, r] of dossiers) {
  const oldScores = {}; for (const [k, v] of Object.entries(r.extracted_qqps)) if (typeof v?.score === "number") oldScores[k] = v.score;
  const qqpNames = Object.keys(oldScores);
  const newRaw = await scoreQQPs(r.sqm_extraction, qqpNames);
  if (!newRaw) { console.log(`${did.slice(0,8)}: API faalde, skip`); continue; }
  const newScores = {}; for (const [k, v] of Object.entries(newRaw)) if (typeof v?.score === "number") newScores[k] = v.score;

  const oldMean = Object.values(oldScores).reduce((a, b) => a + b, 0) / Object.keys(oldScores).length;
  const common = qqpNames.filter((q) => q in newScores);
  const newMean = common.reduce((a, q) => a + newScores[q], 0) / common.length;
  oldMeans.push(oldMean); newMeans.push(newMean);
  // F with current intercept (1.2824) — old vs new scores
  const fOld = predictF(oldScores, model.intercept);
  const fNewSameIntercept = predictF(newScores, model.intercept);
  rows.push({ did: did.slice(0, 8), oldMean, newMean, fOld, fNewSameIntercept });
  console.log(`${did.slice(0,8)}: score-gem ${oldMean.toFixed(2)} → ${newMean.toFixed(2)}   F(int=1.28) ${fOld.toFixed(2)} → ${fNewSameIntercept.toFixed(2)}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`\n${"═".repeat(70)}`);
console.log(`Gemiddelde score-gem:  OUD ${avg(oldMeans).toFixed(3)}  →  NIEUW ${avg(newMeans).toFixed(3)}  (shift +${(avg(newMeans)-avg(oldMeans)).toFixed(3)})`);
// what intercept makes the average dossier land at F=0.96 with NEW scores?
const newSumWMean = avg(newMeans.map((_, i) => {
  const [did, r] = dossiers[i]; return 0;
}));
console.log(`\nMet NIEUWE scores: gemiddelde dossier score-gem ≈ ${avg(newMeans).toFixed(3)}`);
console.log("→ Als scores nu rond 0 centreren, kan de intercept terug naar ~0.96.");
console.log("→ Exacte intercept volgt uit een volledige her-extractie (deze test is text-only, zonder plan-images).");
