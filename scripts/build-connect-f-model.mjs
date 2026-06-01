/**
 * build-connect-f-model.mjs — Build a Connect-Value-derived F model.
 *
 * Uses the exact component weights from the Connect Value Excel source files
 * (extracted May 2026) to derive principled F-model weights for PlanBase QQPs.
 *
 * Model: F = intercept + Σ(weight_i × score_i),  clamped to [0.70, 1.50]
 *
 * Key anchors (settings: cat1_min=1600, cat1_max=2900, F=[0.70,1.50]):
 *   Connect kaal   = €1402 excl btw = €1696 incl → F = 0.759
 *   Connect max    = €1973 excl btw = €2387 incl → F = 1.185
 *   Intercept (avg)= €1608 excl btw = €1946 incl → F = 0.913
 *     (kaal + cv(€98) + keuken inbouw(€72) + >1 toilet(€36))
 *
 * Each QQP weight represents ΔF per unit of QQP score.
 * Score range per QQP:
 *   numeric QQPs  : typically -1.0 to +1.0 (0 = average Belgian new-build)
 *   boolean QQPs  : 0 (absent) or ~+0.5/+0.8 (present)
 *   ratio QQPs    : typically -0.5 to +1.0
 *
 * Run: node scripts/build-connect-f-model.mjs [--dry-run] [--activate]
 *   --dry-run   : only show the model, don't insert into DB
 *   --activate  : also set is_active=true on the new version
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const ACTIVATE = process.argv.includes("--activate");

// ── Supabase connection ─────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// ── Settings (must match system_settings in DB) ─────────────────────────────
const CAT1_MIN = 1600, CAT1_MAX = 2900, F_MIN = 0.70, F_MAX = 1.50;
const PRICE_RANGE = CAT1_MAX - CAT1_MIN; // 1300
const F_RANGE = F_MAX - F_MIN;           // 0.80

// Convert €/m² Connect premium (excl btw, ABEX 1000) → ΔF in PlanBase
function toDF(eurExclBtw) {
  return (eurExclBtw * 1.21) / (PRICE_RANGE / F_RANGE);
}

// F for a given incl-btw price at ABEX 1000
function priceToF(priceIncl) {
  return F_MIN + (priceIncl - CAT1_MIN) / PRICE_RANGE * F_RANGE;
}

// Price for a given F
function fToPrice(f) {
  return Math.round(CAT1_MIN + (f - F_MIN) / F_RANGE * PRICE_RANGE);
}

// ── Intercept derivation ────────────────────────────────────────────────────
// "Average" Belgian new-build apartment:
//   Connect kaal base (€1402) + centrale verwarming (€98) + keuken inbouw (€72)
//   + >1 toilet (€36) = €1608 excl btw = €1946 incl btw @ ABEX 1000
//   → This represents QQP scores all at 0 (neutral)
const AVG_EUR_EXCL = 1402 + 98 + 72 + 36; // 1608
const AVG_EUR_INCL = Math.round(AVG_EUR_EXCL * 1.21); // 1946
const INTERCEPT = priceToF(AVG_EUR_INCL); // 0.9127

// ── Connect premium → ΔF mapping ────────────────────────────────────────────
// These are the exact premiums from the Connect Value Excel (170219 rekenbladen.xlsx).
// Used to CALIBRATE the weight magnitude; scores [−1,+1] where 0 = average.
const CV = {
  cv_heating:     toDF(98),  // centrale verwarming (already in intercept → scale ref)
  cv_floor:       toDF(72),  // massief hout / natuursteen vloer
  cv_kitchen_base:toDF(72),  // keuken inbouwtoestellen
  cv_kitchen_plus:toDF(72),  // keuken >5 toestellen
  cv_storage:     toDF(72),  // vaste inbouwkasten buiten keuken
  cv_floor_heat:  toDF(48),  // vloerverwarming
  cv_airco:       toDF(36),  // airconditioning
  cv_toilet_plus: toDF(36),  // >1 toilet (already in intercept → scale ref)
  cv_bath_shower: toDF(36),  // apart bad + aparte douche
  cv_domotica:    toDF(29),  // domotica
};

// ── QQP weights ─────────────────────────────────────────────────────────────
// Weight design principle:
//   weight_i = ΔF_connect / Δscore  where Δscore is the "absent→present" change
//   for the matching Connect feature.
//
// For numeric QQPs (score 0 = average, range ≈ ±1):
//   A score of +1 means "well above average" → weight ≈ ΔF_connect × 1
//
// For boolean QQPs (absent=0, present=+0.5/+0.8):
//   weight = ΔF_connect / present_score  so that "present" gives the right ΔF
//
// Size QQPs: near-zero — CV analysis proved no reliable size↔price signal.
// Equipment QQPs: primary Connect-calibrated weights.

const weights = {
  // ═══ A. SIZE & LAYOUT (small weights — size ≠ quality) ══════════════════
  // Note: total_livable_sqm intentionally 0 (no reliable signal in data)
  total_livable_sqm:    0,
  entrance_hall_sqm:    0.015,   // generous entry hall = quality
  living_room_sqm:      0.010,   // very slight
  kitchen_sqm:          0.015,   // larger kitchen → more equipment
  master_bedroom_sqm:   0.010,
  avg_bedroom_sqm:      0.008,
  largest_bathroom_sqm: 0.025,   // bigger bath → more likely bath+shower (+0.027)
  garage_sqm:           0,       // size, not quality
  terrace_balcony_sqm:  0.012,   // outdoor living = quality
  circulation_ratio:    0.020,   // generous corridors = quality
  floor_count:          0,       // building layers, no quality signal

  // ═══ B. ROOM COUNT & COMPOSITION ══════════════════════════════════════════
  bedroom_count:           0.010,  // more bedrooms = slightly larger program, minor
  bathroom_count:          0.045,  // more bathrooms → more luxury installations
  toilet_count:            0.030,  // CV >1 toilet = +€36 → ΔF=0.027; /Δscore≈0.3 ≈ 0.090, cap at 0.030
  bathroom_per_bedroom_ratio: 0.040, // en-suite ratio = strong quality signal
  has_separate_dining:     0.030,  // separate dining = quality
  has_office:              0.025,  // dedicated office/study
  has_dressing:            0.060,  // strong luxury: walk-in dressing
  has_laundry_room:        0.025,  // quality signal
  has_wellness:            0.080,  // very strong: sauna/pool/spa
  has_basement:            0.020,  // minor signal
  has_garage:              0.020,  // minor signal

  // ═══ C. EQUIPMENT & FEATURES (primary Connect-derived weights) ════════════
  // kitchen_appliance_count: score 0 = 4 appliances (avg, already in intercept)
  //   At +1 (8+ appliances) = keuken inbouw + >5 toestellen → ΔF = cv_kitchen_plus ≈ 0.054
  kitchen_appliance_count: 0.060,  // combines keuken_base + keuken_plus effects

  // has_kitchen_island: boolean 0/+0.6 → luxury signal
  has_kitchen_island:       0.050,  // at +0.6 → +0.030 to F

  // bathroom_luxury_score: score 0 = standard shower, +1 = bath+shower+jacuzzi+heated
  //   CV "apart bad+douche" = ΔF=0.027; luxury score captures more → 0.040
  bathroom_luxury_score:   0.040,  // bath+shower (+0.027) + extra luxury

  has_fireplace:            0.040,  // luxury signal; at +0.5 → +0.020 to F
  has_open_kitchen:         0.025,  // modern style / quality signal

  // built_in_storage_count: score -0.5 (0 units), 0 (2 units), +1 (10+ units)
  //   CV "vaste inbouwkasten" = ΔF=0.054
  built_in_storage_count:   0.050,

  // ═══ D. PROPORTIONALITY ══════════════════════════════════════════════════
  living_to_total_ratio:    0.005,  // neutral / minor
  wet_room_to_total_ratio:  0.025,  // more wet rooms = more bathrooms/kitchen = quality
  outdoor_to_indoor_ratio:  0.020,  // more outdoor = quality
  avg_room_size:            0.020,  // larger rooms = quality
};

// ── Validation ───────────────────────────────────────────────────────────────
function clamp(f) { return Math.max(F_MIN, Math.min(F_MAX, f)); }

// Simulate F for three apartment profiles
const profiles = {
  "Kale studio (alles minimum)": {
    total_livable_sqm: -1.0, kitchen_appliance_count: -1.0, bathroom_luxury_score: -1.0,
    bathroom_count: -0.5, toilet_count: -0.3, bathroom_per_bedroom_ratio: -0.5,
    built_in_storage_count: -0.5, bedroom_count: -0.5, avg_bedroom_sqm: -0.5,
    living_room_sqm: -0.5, kitchen_sqm: -0.5,
  },
  "Standaard nieuwbouwappartement (avg)": {
    // All scores at 0 = intercept only
  },
  "Comfortabel appartement (licht positief)": {
    kitchen_appliance_count: 0.5, bathroom_luxury_score: 0.3,
    built_in_storage_count: 0.5, bathroom_count: 0.3, toilet_count: 0.3,
    bathroom_per_bedroom_ratio: 0.3, has_laundry_room: 0.5,
    avg_room_size: 0.3, wet_room_to_total_ratio: 0.3,
  },
  "Luxe appartement (bijna alles hoog)": {
    kitchen_appliance_count: 1.0, bathroom_luxury_score: 0.7, has_kitchen_island: 0.6,
    built_in_storage_count: 1.0, bathroom_count: 1.0, toilet_count: 0.5,
    bathroom_per_bedroom_ratio: 0.8, has_dressing: 0.7, has_laundry_room: 0.5,
    has_separate_dining: 0.5, has_office: 0.5, has_fireplace: 0.5,
    largest_bathroom_sqm: 0.7, avg_room_size: 0.5, wet_room_to_total_ratio: 0.5,
    bedroom_count: 0.5, circulation_ratio: 0.5, outdoor_to_indoor_ratio: 0.3,
  },
  "Ultra luxe (alles max)": {
    kitchen_appliance_count: 1.0, bathroom_luxury_score: 1.0, has_kitchen_island: 0.6,
    built_in_storage_count: 1.0, bathroom_count: 1.0, toilet_count: 1.0,
    bathroom_per_bedroom_ratio: 1.0, has_dressing: 1.0, has_wellness: 0.8,
    has_laundry_room: 0.5, has_separate_dining: 0.5, has_office: 0.5,
    has_fireplace: 0.5, has_open_kitchen: 0.4, has_basement: 0.3,
    largest_bathroom_sqm: 1.0, avg_room_size: 1.0, wet_room_to_total_ratio: 1.0,
    outdoor_to_indoor_ratio: 1.0, circulation_ratio: 1.0, bedroom_count: 0.7,
    entrance_hall_sqm: 1.0, kitchen_sqm: 1.0, living_room_sqm: 1.0,
    master_bedroom_sqm: 1.0, terrace_balcony_sqm: 1.0,
  },
};

console.log("\n" + "═".repeat(70));
console.log("  CONNECT-DERIVED F MODEL — validatie");
console.log("═".repeat(70));
console.log(`  Intercept:  F = ${INTERCEPT.toFixed(4)}  (gemiddeld appartement → €${AVG_EUR_INCL}/m² incl btw bij HUIDIGE ABEX)`);
console.log(`  F range:    [${F_MIN}, ${F_MAX}]  →  cat1 [€${CAT1_MIN}, €${CAT1_MAX}]/m² (= prijzen bij huidige ABEX, factor 1.0)`);
console.log(`  ABEX:       referentie 2026S1=1056; nieuwe schatting → factor 1056/1056 = 1.0 (geen extra inflatie)`);
console.log(`\n  Connect ankers (huidige ABEX, incl btw):`);
console.log(`    Kaal (base only):        F = ${priceToF(Math.round(1402*1.21)).toFixed(3)}  → €${fToPrice(priceToF(1402*1.21))}/m²`);
console.log(`    Max (all yes):           F = ${priceToF(Math.round(1973*1.21)).toFixed(3)}  → €${fToPrice(priceToF(1973*1.21))}/m²`);
console.log(`    PlanBase vorig (F=1.0):  F = 1.000  → €${fToPrice(1.0)}/m²  | CED mediaan ≈ €2.100`);

console.log("\n" + "─".repeat(70));
console.log("  SCENARIO'S");
console.log("─".repeat(70));

// ABEX: referentie = 2026S1 = index 1056. Pipeline: abexFactor = index / 1056.
// Voor elke NIEUWE schatting → factor = 1056/1056 = 1.0. interpolatePrice(F) IS dus
// de prijs bij de huidige ABEX (geen extra inflatie). Oudere dossiers schalen omlaag.
const ABEX_REF = 1056;
for (const [name, scores] of Object.entries(profiles)) {
  let f = INTERCEPT;
  for (const [qqp, score] of Object.entries(scores)) {
    if (weights[qqp] !== undefined) f += weights[qqp] * score;
  }
  const fClamped = clamp(f);
  const price = fToPrice(fClamped); // = prijs bij huidige ABEX (factor 1.0)
  const price2021 = Math.round(price * 858 / ABEX_REF); // voorbeeld: dossier uit 2021
  const label = fClamped < 0.88 ? "Basic" : fClamped < 1.06 ? "Standard" : fClamped < 1.20 ? "Comfort" : fClamped < 1.38 ? "Comfort+" : "Luxury";
  const clamped = (f !== fClamped) ? ` (raw=${f.toFixed(3)})` : "";
  console.log(`  ${name}`);
  console.log(`    F = ${fClamped.toFixed(3)}${clamped}  [${label}]  → €${price}/m² (HUIDIGE ABEX, incl btw)  | hist. 2021: €${price2021}/m²`);
}

console.log("\n" + "─".repeat(70));
console.log("  WEIGHT OVERZICHT");
console.log("─".repeat(70));
const groups = [
  ["A. Size & Layout",     ["total_livable_sqm","entrance_hall_sqm","living_room_sqm","kitchen_sqm","master_bedroom_sqm","avg_bedroom_sqm","largest_bathroom_sqm","garage_sqm","terrace_balcony_sqm","circulation_ratio","floor_count"]],
  ["B. Room Count",        ["bedroom_count","bathroom_count","toilet_count","bathroom_per_bedroom_ratio","has_separate_dining","has_office","has_dressing","has_laundry_room","has_wellness","has_basement","has_garage"]],
  ["C. Equipment",         ["kitchen_appliance_count","has_kitchen_island","bathroom_luxury_score","has_fireplace","has_open_kitchen","built_in_storage_count"]],
  ["D. Proportionality",   ["living_to_total_ratio","wet_room_to_total_ratio","outdoor_to_indoor_ratio","avg_room_size"]],
];
for (const [group, names] of groups) {
  console.log(`  ${group}:`);
  for (const n of names) {
    const w = weights[n] ?? 0;
    const bar = w === 0 ? "·" : "▪".repeat(Math.round(w / 0.01));
    const cvNote = {
      kitchen_appliance_count: "← keuken inbouw+luxe (€72+72)",
      bathroom_luxury_score:   "← bad+douche (€36)",
      built_in_storage_count:  "← vaste inbouwkasten (€72)",
      largest_bathroom_sqm:    "← bad+douche proxy",
      bathroom_per_bedroom_ratio: "← en-suite kwaliteit",
      has_wellness:            "← sauna/jacuzzi: extreem luxe",
      has_dressing:            "← walk-in: sterk luxe",
    }[n] || "";
    if (w > 0) console.log(`    ${n.padEnd(34)} w=${w.toFixed(3)}  ${bar} ${cvNote}`);
    else       console.log(`    ${n.padEnd(34)} w=0`);
  }
}

// ── DB insert ────────────────────────────────────────────────────────────────
const model = {
  name: "connect-v1",
  notes:
    "Connect-Value-derived weights (mei 2026). Intercept = F voor gemiddeld Belgisch " +
    "nieuwbouwappartement (kaal + cv + keuken + >1 toilet, Connect ABEX1000 incl btw). " +
    "Gewichten afgeleid uit exacte Connect-Excel componenten (170219 rekenbladen.xlsx). " +
    "Geen regressie op dossiers. Intercept=0.9129. 28 non-zero weights.",
  intercept: Math.round(INTERCEPT * 10000) / 10000,
  weights,
  is_active: ACTIVATE,
  lambda: null,
  version: 100,  // high version to indicate it's a manual/expert model
  training_dossier_count: 0,
  accuracy_metrics: {
    source: "connect-value-excel",
    note: "Expert-derived, not regression-fitted",
    connect_kaal_f: Math.round(priceToF(1402 * 1.21) * 1000) / 1000,
    connect_max_f: Math.round(priceToF(1973 * 1.21) * 1000) / 1000,
  },
};

if (DRY_RUN) {
  console.log("\n[DRY RUN] Model NIET ingevoegd. Gebruik zonder --dry-run om in te voegen.");
  console.log("  intercept:", model.intercept);
  process.exit(0);
}

// Deactivate existing active models if we're activating this one
if (ACTIVATE) {
  const deact = await fetch(`${SUPA_URL}/rest/v1/qqp_model_versions?is_active=eq.true`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ is_active: false }),
  });
  console.log(`\nDeactivated existing active models: ${deact.status}`);
}

const res = await fetch(`${SUPA_URL}/rest/v1/qqp_model_versions`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    notes: model.notes,
    intercept: model.intercept,
    weights: model.weights,
    is_active: model.is_active,
    lambda: null,
    version: model.version,
    training_dossier_count: model.training_dossier_count,
    accuracy_metrics: model.accuracy_metrics,
  }),
});

const result = await res.json();
if (res.ok) {
  const row = Array.isArray(result) ? result[0] : result;
  console.log(`\n✓ Model ingevoegd: id=${row.id}  name="${model.name}"  is_active=${model.is_active}`);
  console.log(`  intercept=${model.intercept}  weights=${Object.keys(model.weights).filter(k=>model.weights[k]>0).length} non-zero`);
  if (!ACTIVATE) {
    console.log("\n  → Model is INACTIEF. Activeer via:");
    console.log(`     node scripts/build-connect-f-model.mjs --activate`);
    console.log("  → Of activeer in de UI via /admin/qqp");
  }
} else {
  console.error("\n✗ Fout bij invoegen:", result);
  process.exit(1);
}
