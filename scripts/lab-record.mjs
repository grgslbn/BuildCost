/**
 * lab-record.mjs — write a chat-produced extraction into the Prompt Lab.
 *
 * Replicates the production pipeline math (predictF, calculateCost, regional
 * factor, ABEX, expert-F back-calc) so the recorded numbers match a real
 * benchmark run. Creates one evaluation_run + one evaluation_result per dossier
 * so the result shows up in the Dossiers tab (Kost Δ vs CED) and the dossier
 * walkthrough.
 *
 * Usage:  node scripts/lab-record.mjs <input.json>
 *
 * input.json = {
 *   "runName": "Chat test 2026-05-29",
 *   "items": [{
 *     "dossierId": "uuid",
 *     "postcode": "8600",
 *     "sqmExtraction": { ...full SQM JSON... },   // includes project_totals
 *     "qqpValues": { "name": {"score":0.1,"confidence":0.6,"reasoning":"..."} }
 *   }]
 * }
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── env ───────────────────────────────────────────────────────────────
const envText = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing Supabase env"); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const api = (path, init = {}) => fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

// ── pipeline math (inlined to match production exactly) ─────────────────
const F_MIN = 0.70, F_MAX = 1.50;
const interp = (f, min, max) => min + ((f - F_MIN) / (F_MAX - F_MIN)) * (max - min);

const REGIONAL_RANGES = [
  [1000,1210,1.000],[1300,1499,0.967],[1500,1999,0.987],[2000,2060,0.987],
  [2070,2999,0.967],[3000,3499,0.967],[3500,3999,0.953],[4000,4999,0.953],
  [5000,5999,0.940],[6000,6599,0.920],[6600,6999,0.940],[7000,7999,0.940],
  [8000,8299,0.973],[8300,8699,0.987],[8700,8999,0.967],[9000,9299,0.973],
  [9300,9999,0.953],
];
function regionalCoeff(postcode) {
  if (!postcode) return 1.0;
  const pc = parseInt(String(postcode).trim(), 10);
  if (isNaN(pc)) return 1.0;
  for (const [from, to, c] of REGIONAL_RANGES) if (pc >= from && pc <= to) return c;
  return 1.0;
}

function predictF(scores, model) {
  let f = model.intercept ?? 1.0;
  for (const [name, w] of Object.entries(model.weights ?? {})) f += (scores[name] ?? 0) * w;
  return Math.max(F_MIN, Math.min(F_MAX, f));
}

function backcalcExpertF(totalCost, areas, pricing, regional, abex) {
  const ext = regional * abex;
  if (!ext) return null;
  const before = totalCost / ext;
  const minCost = areas.cat1 * pricing.cat1_min + areas.cat2 * pricing.cat2_min + areas.cat3 * pricing.cat3_min;
  const slope = areas.cat1 * (pricing.cat1_max - pricing.cat1_min)
    + areas.cat2 * (pricing.cat2_max - pricing.cat2_min)
    + areas.cat3 * (pricing.cat3_max - pricing.cat3_min);
  if (slope <= 0) return null;
  const r = (before - minCost) / slope;
  return Math.max(F_MIN, Math.min(F_MAX, F_MIN + r * (F_MAX - F_MIN)));
}

const errPct = (pred, exp) => (pred == null || exp == null || exp === 0) ? null : ((pred - exp) / exp) * 100;

// ── load config (once) ──────────────────────────────────────────────────
async function loadConfig() {
  const s = await (await api(`system_settings?select=key,value&key=in.(cat1_price_min,cat1_price_max,cat2_price_min,cat2_price_max,cat3_price_min,cat3_price_max,abex_reference_year,abex_reference_semester)`)).json();
  const set = Object.fromEntries(s.map((r) => [r.key, r.value]));
  const pricing = {
    cat1_min: +set.cat1_price_min || 1100, cat1_max: +set.cat1_price_max || 1900,
    cat2_min: +set.cat2_price_min || 550,  cat2_max: +set.cat2_price_max || 950,
    cat3_min: +set.cat3_price_min || 330,  cat3_max: +set.cat3_price_max || 570,
  };
  const year = +set.abex_reference_year || 2026;
  const sem = +set.abex_reference_semester || 1;
  const abexRow = await (await api(`abex_index?select=index_value&year=eq.${year}&semester=eq.${sem}`)).json();
  const abex = abexRow?.[0]?.index_value ? Number(abexRow[0].index_value) / 1056 : 1.0;
  const modelRow = await (await api(`qqp_model_versions?select=intercept,weights&is_active=eq.true`)).json();
  const model = modelRow?.[0] ?? { intercept: 1.0, weights: {} };
  return { pricing, abex, model };
}

// ── main ─────────────────────────────────────────────────────────────────
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { pricing, abex, model } = await loadConfig();

// create run
const runName = input.runName || "Chat test";
const runRes = await api("evaluation_runs", {
  method: "POST",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({ name: runName, status: "complete", dossier_count: input.items.length, subset_mode: "chat" }),
});
const run = (await runRes.json())[0];
if (!run?.id) { console.error("Run insert failed:", run); process.exit(1); }
console.log(`Run: ${run.id} (${runName})`);

for (const item of input.items) {
  // If the chat parsed the expert berekening, upsert accurate GT first.
  if (item.expert) {
    const e = item.expert;
    const existing = await (await api(`benchmark_ground_truth?select=id&dossier_id=eq.${item.dossierId}`)).json();
    const gtPayload = {
      dossier_id: item.dossierId,
      expert_total_price: e.total ?? null,
      expert_cat1_sqm: e.cat1 ?? null,
      expert_cat2_sqm: e.cat2 ?? null,
      expert_cat3_sqm: e.cat3 ?? null,
      expert_total_sqm: (e.cat1 ?? 0) + (e.cat2 ?? 0) + (e.cat3 ?? 0),
      extraction_confidence: 1.0,
      verified: true,
      notes: e.cat1PerSqm != null ? `Expert CAT1 €/m²=${e.cat1PerSqm} (uit berekening)` : null,
    };
    if (existing?.[0]?.id) {
      await api(`benchmark_ground_truth?dossier_id=eq.${item.dossierId}`, { method: "PATCH", body: JSON.stringify(gtPayload) });
    } else {
      await api("benchmark_ground_truth", { method: "POST", body: JSON.stringify(gtPayload) });
    }
  }
  const gtRows = await (await api(`benchmark_ground_truth?select=*&dossier_id=eq.${item.dossierId}`)).json();
  const gt = gtRows?.[0];
  const totals = item.sqmExtraction.project_totals || {};
  const cat1 = totals.total_cat1_sqm ?? item.cat1 ?? 0;
  const cat2 = totals.total_cat2_sqm ?? item.cat2 ?? 0;
  const cat3 = totals.total_cat3_sqm ?? item.cat3 ?? 0;

  const scores = {};
  for (const [n, d] of Object.entries(item.qqpValues || {})) scores[n] = d.score;
  const predF = predictF(scores, model);

  const regional = regionalCoeff(item.postcode);
  const p1 = interp(predF, pricing.cat1_min, pricing.cat1_max);
  const p2 = interp(predF, pricing.cat2_min, pricing.cat2_max);
  const p3 = interp(predF, pricing.cat3_min, pricing.cat3_max);
  const subtotal = cat1 * p1 + cat2 * p2 + cat3 * p3;
  const total = Math.round(subtotal * regional * abex);

  const expertAreas = { cat1: gt?.expert_cat1_sqm ?? 0, cat2: gt?.expert_cat2_sqm ?? 0, cat3: gt?.expert_cat3_sqm ?? 0 };
  const expertF = gt?.expert_total_price ? backcalcExpertF(gt.expert_total_price, expertAreas, pricing, regional, abex) : null;

  const costErr = errPct(total, gt?.expert_total_price);
  const row = {
    run_id: run.id,
    dossier_id: item.dossierId,
    extracted_cat1_sqm: cat1, extracted_cat2_sqm: cat2, extracted_cat3_sqm: cat3,
    sqm_extraction: item.sqmExtraction,
    cat1_error_pct: errPct(cat1, gt?.expert_cat1_sqm),
    cat2_error_pct: errPct(cat2, gt?.expert_cat2_sqm),
    cat3_error_pct: errPct(cat3, gt?.expert_cat3_sqm),
    extracted_qqps: item.qqpValues,
    predicted_f: predF, expert_f: expertF, f_error: (expertF != null ? predF - expertF : null),
    predicted_total_cost: total, cost_error_pct: costErr,
    error_message: null,
  };
  const ins = await api("evaluation_results", { method: "POST", body: JSON.stringify(row) });
  if (!ins.ok) { console.error(`  ${item.dossierId}: insert failed`, await ins.text()); continue; }
  // CAT1 unit price comparison (the metric that matters — CED has no F)
  const toolCat1 = Math.round(p1);
  // Prefer the REAL expert CAT1 €/m² from the berekening; fall back to back-calc.
  const expCat1Real = item.expert?.cat1PerSqm ?? null;
  const expCat1Backcalc = expertF != null ? Math.round(interp(expertF, pricing.cat1_min, pricing.cat1_max)) : null;
  const expCat1 = expCat1Real ?? expCat1Backcalc;
  const cat1PriceErr = errPct(toolCat1, expCat1);
  console.log(`  ${item.dossierId}:`);
  console.log(`    SQM   cat1=${cat1}(${fmt(row.cat1_error_pct)}) cat2=${cat2}(${fmt(row.cat2_error_pct)}) cat3=${cat3}(${fmt(row.cat3_error_pct)})`);
  console.log(`    CAT1 €/m² (na F): tool €${toolCat1.toLocaleString()} vs expert €${expCat1?.toLocaleString() ?? "?"}${expCat1Real ? " (echt uit berekening)" : " (back-calc)"} (${fmt(cat1PriceErr)})  [tool F=${predF.toFixed(2)}]`);
  console.log(`    Kost: tool €${total.toLocaleString()} vs CED €${gt?.expert_total_price?.toLocaleString() ?? "?"} (${fmt(costErr)})`);
}
function fmt(n) { return n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`; }
console.log("Done — open the dossier in Prompt Lab to see the walkthrough.");
