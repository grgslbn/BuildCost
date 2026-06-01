/**
 * test-connect-f.mjs — offline test of the active connect-v1 F-model against
 * the CED expert ground truth, using stored QQP scores per dossier.
 *
 * For each GT dossier with stored extracted_qqps:
 *   F_old  = stored predicted_f (previous model)
 *   F_new  = predictF(qqps, connect-v1)
 *   prices = interpolatePrice(F, min, max) per category
 *   total  = Σ(EXPERT sqm × price) × regional(=1.0) × abex(=1.0)
 *            → isolates the PRICE model (no SQM error)
 * Compares predicted total vs expert_total_price.
 *
 * Also reports the cat1 €/m² (living) old vs new — the key metric.
 *
 * Run: node scripts/test-connect-f.mjs
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

// ── Pricing config (settings, unchanged) ────────────────────────────────────
const F_MIN = 0.70, F_MAX = 1.50;
const PRICING = { cat1: [1600, 2900], cat2: [900, 1500], cat3: [500, 900] };
const interp = (f, [mn, mx]) => mn + (f - F_MIN) / (F_MAX - F_MIN) * (mx - mn);
const clamp = (f) => Math.max(F_MIN, Math.min(F_MAX, f));

// ── Fetch active model + GT + latest results ────────────────────────────────
const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=intercept,weights,notes`, { headers: H })).json())[0];
const intercept = model.intercept;
const W = model.weights;
console.log(`Actief model: intercept=${intercept}  (${(model.notes||"").slice(0,40)}…)\n`);

const predictF = (scores) => {
  let f = intercept;
  for (const [k, v] of Object.entries(scores)) f += (W[k] ?? 0) * v;
  return clamp(f);
};

const gtRows = await (await fetch(`${U}/rest/v1/benchmark_ground_truth?select=dossier_id,expert_total_price,expert_cat1_sqm,expert_cat2_sqm,expert_cat3_sqm`, { headers: H })).json();
const gtByDossier = {};
for (const g of gtRows) gtByDossier[g.dossier_id] = g;

const results = await (await fetch(`${U}/rest/v1/evaluation_results?select=dossier_id,extracted_qqps,predicted_f,expert_f,extracted_cat1_sqm,extracted_cat2_sqm,extracted_cat3_sqm,created_at&order=created_at.desc`, { headers: H })).json();

// latest result per dossier that has qqps
const latest = {};
for (const r of results) {
  if (!r.extracted_qqps || !Object.keys(r.extracted_qqps).length) continue;
  if (!latest[r.dossier_id]) latest[r.dossier_id] = r;
}

// dossier meta: name, postcode (regional), abex year/semester, building type
const dossiers = await (await fetch(`${U}/rest/v1/reference_dossiers?select=id,plan_file_name,postcode,building_type,apartment_count,price_abex_year,price_abex_semester`, { headers: H })).json();
const metaById = {}; for (const d of dossiers) metaById[d.id] = d;

// regional coefficient (inlined from src/lib/cost/regional-coefficients.ts)
const REG = [[1000,1210,1.0],[1300,1499,0.967],[1500,1999,0.987],[2000,2060,0.987],[2070,2999,0.967],[3000,3499,0.967],[3500,3999,0.953],[4000,4999,0.953],[5000,5999,0.940],[6000,6599,0.920],[6600,6999,0.940],[7000,7999,0.940],[8000,8299,0.973],[8300,8699,0.987],[8700,8999,0.967],[9000,9299,0.973],[9300,9999,0.953]];
const regional = (pc) => { const n = parseInt(pc, 10); if (isNaN(n)) return 1.0; for (const [a, b, c] of REG) if (n >= a && n <= b) return c; return 1.0; };

// abex index map (year-semester → index)
const abexRows = await (await fetch(`${U}/rest/v1/abex_index?select=year,semester,index_value`, { headers: H })).json();
const abexMap = {}; for (const a of abexRows) abexMap[`${a.year}-${a.semester}`] = a.index_value;
const abexFactor = (y, s) => { const idx = abexMap[`${y}-${s}`]; return idx ? idx / 1056 : 1.0; };

// ── Evaluate ─────────────────────────────────────────────────────────────────
const flatten = (q) => { const o = {}; for (const [k, v] of Object.entries(q)) if (v && typeof v.score === "number") o[k] = v.score; return o; };
const fmt = (n) => "€" + Math.round(n).toLocaleString("nl-BE");
const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";

const rows = [];
for (const [did, gt] of Object.entries(gtByDossier)) {
  const r = latest[did];
  if (!r) continue;
  const meta = metaById[did] || {};
  const scores = flatten(r.extracted_qqps);
  const fOld = r.predicted_f ?? 1.0;
  const fNew = predictF(scores);
  const a = { cat1: gt.expert_cat1_sqm || 0, cat2: gt.expert_cat2_sqm || 0, cat3: gt.expert_cat3_sqm || 0 };

  const regF = regional(meta.postcode);
  const abexF = abexFactor(meta.price_abex_year, meta.price_abex_semester);
  const factor = regF * abexF;

  const costAt = (f) => (a.cat1 * interp(f, PRICING.cat1) + a.cat2 * interp(f, PRICING.cat2) + a.cat3 * interp(f, PRICING.cat3)) * factor;
  // DECOUPLED: F drives only cat1; cat2/cat3 fixed at Connect-derived prices (garage €900, terras €500)
  const costDecoupled = (f) => (a.cat1 * interp(f, PRICING.cat1) + a.cat2 * 900 + a.cat3 * 500) * factor;
  const totOld = costAt(fOld);
  const totNew = costAt(fNew);
  const totDec = costDecoupled(fNew);
  const exp = gt.expert_total_price;

  const totSqm = (gt.expert_total_sqm) || (a.cat1 + a.cat2 + a.cat3) || 1;
  const expPerSqm = exp / totSqm; // blended expert €/m² (sanity check)
  rows.push({
    name: (meta.plan_file_name || did).replace(/\.pdf$/i, "").slice(0, 28),
    type: (meta.building_type || "?").slice(0, 6),
    fOld, fNew, expF: r.expert_f,
    cat1pOld: interp(fOld, PRICING.cat1) * factor, cat1pNew: interp(fNew, PRICING.cat1) * factor,
    regF, abexF, a, totOld, totNew, totDec, exp, expPerSqm,
    plausible: expPerSqm >= 1000 && expPerSqm <= 2800,
    cat1dominant: a.cat1 >= (a.cat2 + a.cat3),
    dOld: totOld / exp - 1, dNew: totNew / exp - 1, dDec: totDec / exp - 1,
  });
}

rows.sort((x, y) => Math.abs(x.dNew) - Math.abs(y.dNew));

console.log("═".repeat(122));
console.log("Dossier".padEnd(20) + "F_oud→nieuw(expF) cat1€/m² o→n  c1/c2/c3 m²      exp€/m²    Δ OUD    Δ NIEUW");
console.log("═".repeat(122));
for (const r of rows) {
  const areas = `${r.a.cat1}/${r.a.cat2}/${r.a.cat3}`;
  const flag = r.plausible ? "  " : " ⚠";
  console.log(
    r.name.padEnd(20) +
    `${r.fOld.toFixed(2)}→${r.fNew.toFixed(2)}`.padEnd(11) +
    `(${(r.expF ?? 0).toFixed(2)})`.padEnd(7) +
    `${Math.round(r.cat1pOld)}→${Math.round(r.cat1pNew)}`.padEnd(13) +
    areas.padEnd(16) +
    `€${Math.round(r.expPerSqm)}`.padEnd(8) + flag +
    pct(r.dOld).padStart(7) + "  " +
    pct(r.dNew).padStart(7)
  );
}

// ── Aggregate ────────────────────────────────────────────────────────────────
const agg = (subset, key) => {
  const ds = subset.map((r) => Math.abs(r[key]));
  if (!ds.length) return { med: 0, mae: 0, w10: 0, w15: 0, w20: 0, n: 0 };
  const sorted = [...ds].sort((a, b) => a - b);
  return {
    med: sorted[Math.floor(sorted.length / 2)],
    mae: ds.reduce((s, x) => s + x, 0) / ds.length,
    w10: ds.filter((d) => d <= 0.10).length,
    w15: ds.filter((d) => d <= 0.15).length,
    w20: ds.filter((d) => d <= 0.20).length,
    n: ds.length,
  };
};
const report = (label, subset) => {
  const o = agg(subset, "dOld"), n = agg(subset, "dNew"), d = agg(subset, "dDec");
  console.log(`\n${label} (n=${o.n})`);
  console.log(`                          mediaan|Δ|   gem|Δ|     <10%   <15%   <20%`);
  console.log(`  OUD (F op alles)        ${pct(o.med).padStart(8)}  ${pct(o.mae).padStart(8)}    ${o.w10}/${o.n}    ${o.w15}/${o.n}   ${o.w20}/${o.n}`);
  console.log(`  NIEUW (F op alles)      ${pct(n.med).padStart(8)}  ${pct(n.mae).padStart(8)}    ${n.w10}/${n.n}    ${n.w15}/${n.n}   ${n.w20}/${n.n}`);
  console.log(`  NIEUW + cat2/3 ontkop.  ${pct(d.med).padStart(8)}  ${pct(d.mae).padStart(8)}    ${d.w10}/${d.n}    ${d.w15}/${d.n}   ${d.w20}/${d.n}`);
};
console.log("═".repeat(122));
report("ALLE dossiers", rows);
report("ALLEEN plausibele GT (€1000–2800/m²)", rows.filter((r) => r.plausible));
report("CAT1-DOMINANT + plausibel (woongebouwen)", rows.filter((r) => r.plausible && r.cat1dominant));
const susp = rows.filter((r) => !r.plausible);
console.log(`\n⚠ ${susp.length} dossiers met verdachte GT (expert €/m² buiten 1000–2800): ${susp.map((r) => r.name.slice(3, 9)).join(", ")}`);
console.log("  → vermoedelijk onder-getelde expert-SQM of fout in GT-extractie.");
console.log("\nExpert-SQM gebruikt (isoleert prijsmodel). reg×abex=1.0 want postcodes/ABEX niet opgeslagen in deze GT-dossiers.");
