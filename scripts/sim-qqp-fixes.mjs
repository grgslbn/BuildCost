/**
 * sim-qqp-fixes.mjs — simulate two corrections to the systematic negative-score
 * bias found in the QQP extraction, WITHOUT re-extracting:
 *
 *  A. BOOLEAN FIX: boolean QQPs scored negative ("absent") → clamp to 0 (neutral).
 *     The reference-ranges define whenFalse=0.0, but live extraction scores −1.
 *  B. APARTMENT CENTERING: subtract the apartment-population mean per QQP, so
 *     score 0 = average apartment (not average house).
 *
 * For each variant: F distribution (how many floor) + cost error vs CED on the
 * clean cat1-dominant subset (expert SQM, regional/abex=1.0).
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

const F_MIN = 0.70, F_MAX = 1.50;
const PRICING = { cat1: [1600, 2900], cat2: [900, 1500], cat3: [500, 900] };
const interp = (f, [mn, mx]) => mn + (f - F_MIN) / (F_MAX - F_MIN) * (mx - mn);
const clamp = (f) => Math.max(F_MIN, Math.min(F_MAX, f));

const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=intercept,weights`, { headers: H })).json())[0];
const W = model.weights;
const BASE_INTERCEPT = model.intercept;

const BOOLEAN_QQPS = ["has_separate_dining","has_office","has_dressing","has_laundry_room","has_wellness","has_basement","has_garage","has_kitchen_island","has_fireplace","has_open_kitchen"];

// fetch data
const results = await (await fetch(`${U}/rest/v1/evaluation_results?select=dossier_id,extracted_qqps,predicted_f,created_at&order=created_at.desc`, { headers: H })).json();
const latest = {};
for (const r of results) { if (r.extracted_qqps && Object.keys(r.extracted_qqps).length && !latest[r.dossier_id]) latest[r.dossier_id] = r; }
const gt = {};
for (const g of await (await fetch(`${U}/rest/v1/benchmark_ground_truth?select=dossier_id,expert_total_price,expert_cat1_sqm,expert_cat2_sqm,expert_cat3_sqm,expert_total_sqm`, { headers: H })).json()) gt[g.dossier_id] = g;

const flatten = (q) => { const o = {}; for (const [k, v] of Object.entries(q)) if (v && typeof v.score === "number") o[k] = v.score; return o; };
const dossiers = Object.entries(latest).map(([did, r]) => ({ did, scores: flatten(r.extracted_qqps), gt: gt[did] })).filter((d) => d.gt);

// apartment-population means per QQP (from the 15 dossiers) — cover ALL seen QQPs
const allQqps = new Set();
for (const d of dossiers) for (const k of Object.keys(d.scores)) allQqps.add(k);
const means = {};
for (const q of allQqps) {
  const vals = dossiers.map((d) => d.scores[q]).filter((v) => typeof v === "number");
  means[q] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
const mean = (q) => means[q] ?? 0;

// ── Variants ─────────────────────────────────────────────────────────────────
// transform: returns adjusted score for (qqp, score)
const variants = {
  "0. HUIDIG (geen fix)": (q, s) => s,
  "A. Boolean-fix (afwezig→0)": (q, s) => (BOOLEAN_QQPS.includes(q) && s < 0 ? 0 : s),
  "B. Appartement-centrering": (q, s) => s - mean(q),
  "A+B. Boolean-fix + centrering": (q, s) => {
    const s2 = BOOLEAN_QQPS.includes(q) && s < 0 ? 0 : s;
    return s2 - mean(q);
  },
};
// For centering variants, the intercept = desired standard F directly (tussenweg ~0.96).
const TUSSENWEG_F = 0.96;

const predictF = (scores, transform, intercept) => {
  let f = intercept;
  for (const [q, s] of Object.entries(scores)) f += (W[q] ?? 0) * transform(q, s);
  return clamp(f);
};

const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
const cat1dom = (g) => g.expert_cat1_sqm >= (g.expert_cat2_sqm + g.expert_cat3_sqm);
const expPerSqm = (g) => g.expert_total_price / (g.expert_total_sqm || (g.expert_cat1_sqm + g.expert_cat2_sqm + g.expert_cat3_sqm) || 1);

console.log("Apartment-centrering verschuift score 0 naar het gemiddelde van deze 15 appartementen.");
console.log("Voor centrering-varianten: intercept = " + TUSSENWEG_F + " (tussenweg, ~€2000 standaard).\n");

for (const [label, tf] of Object.entries(variants)) {
  const centered = label.includes("centrering");
  const intercept = centered ? TUSSENWEG_F : BASE_INTERCEPT;
  const fs = dossiers.map((d) => predictF(d.scores, tf, intercept));
  const floored = fs.filter((f) => f <= 0.701).length;
  const fSorted = [...fs].sort((a, b) => a - b);
  const fMed = fSorted[Math.floor(fs.length / 2)];
  const fMin = Math.min(...fs), fMax = Math.max(...fs);
  const spread = fMax - fMin;

  // cost error on clean cat1-dominant subset
  const clean = dossiers.filter((d) => cat1dom(d.gt) && expPerSqm(d.gt) >= 1000 && expPerSqm(d.gt) <= 2800);
  const errs = clean.map((d) => {
    const f = predictF(d.scores, tf, intercept);
    const a = { c1: d.gt.expert_cat1_sqm, c2: d.gt.expert_cat2_sqm, c3: d.gt.expert_cat3_sqm };
    const tot = a.c1 * interp(f, PRICING.cat1) + a.c2 * interp(f, PRICING.cat2) + a.c3 * interp(f, PRICING.cat3);
    return Math.abs(tot / d.gt.expert_total_price - 1);
  });
  const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
  const w15 = errs.filter((e) => e <= 0.15).length;

  console.log(`${label}`);
  console.log(`   F: mediaan ${fMed.toFixed(2)}, bereik ${fMin.toFixed(2)}–${fMax.toFixed(2)} (spreiding ${spread.toFixed(2)}), op vloer: ${floored}/${fs.length}`);
  console.log(`   Cost-fout (cat1-dom clean, n=${clean.length}): gem ${pct(mae)}, binnen 15%: ${w15}/${clean.length}\n`);
}
