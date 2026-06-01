/**
 * test-new-system.mjs — validate the FULL fixed system end-to-end:
 *   image-based re-extracted scores (scripts/reextract-images-out.json, fixed prompt)
 *   + clean intercept + decoupled cat2/cat3, vs CED expert GT.
 *
 * Also picks the intercept that centers the average apartment at the lean target.
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
const PRICING = { cat1: [1600, 2900], cat2_fixed: 900, cat3_fixed: 500 };
const interp1 = (f) => PRICING.cat1[0] + (f - F_MIN) / (F_MAX - F_MIN) * (PRICING.cat1[1] - PRICING.cat1[0]);
const clamp = (f) => Math.max(F_MIN, Math.min(F_MAX, f));

const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=weights`, { headers: H })).json())[0];
const W = model.weights;
const gtRows = await (await fetch(`${U}/rest/v1/benchmark_ground_truth?select=dossier_id,expert_total_price,expert_cat1_sqm,expert_cat2_sqm,expert_cat3_sqm,expert_total_sqm`, { headers: H })).json();
const gt = {}; for (const g of gtRows) gt[g.dossier_id] = g;

const reext = JSON.parse(readFileSync("scripts/reextract-images-out.json", "utf8"));

const wsum = (scores) => Object.entries(scores).reduce((s, [q, v]) => s + (W[q] ?? 0) * v, 0);

// pick intercept so the MEAN apartment lands at target F
const meanWsum = reext.reduce((a, r) => a + wsum(r.newScores), 0) / reext.length;
console.log(`Gemiddelde Σw·score (nieuwe beeld-scores) = ${meanWsum.toFixed(3)}`);
for (const target of [0.96, 1.00, 1.04]) {
  console.log(`  intercept voor doel-F ${target} = ${(target - meanWsum).toFixed(3)}`);
}

const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
const expPerSqm = (g) => g.expert_total_price / (g.expert_total_sqm || (g.expert_cat1_sqm + g.expert_cat2_sqm + g.expert_cat3_sqm) || 1);

function evaluate(intercept) {
  const errs = [];
  for (const r of reext) {
    const g = gt[r.id]; if (!g) continue;
    const ep = expPerSqm(g);
    const plausible = ep >= 1000 && ep <= 2800;
    const cat1dom = g.expert_cat1_sqm >= (g.expert_cat2_sqm + g.expert_cat3_sqm);
    const f = clamp(intercept + wsum(r.newScores));
    const tot = g.expert_cat1_sqm * interp1(f) + g.expert_cat2_sqm * PRICING.cat2_fixed + g.expert_cat3_sqm * PRICING.cat3_fixed;
    errs.push({ id: r.id.slice(0, 8), f, d: tot / g.expert_total_price - 1, plausible, cat1dom });
  }
  return errs;
}
function agg(errs) {
  const ds = errs.map((e) => Math.abs(e.d)).sort((a, b) => a - b);
  return { n: ds.length, med: ds[Math.floor(ds.length / 2)], mae: ds.reduce((a, b) => a + b, 0) / ds.length, w15: ds.filter((d) => d <= 0.15).length, w20: ds.filter((d) => d <= 0.20).length };
}

for (const intercept of [0.93, 0.96, 1.007]) {
  const errs = evaluate(intercept);
  const all = agg(errs), plaus = agg(errs.filter((e) => e.plausible)), c1 = agg(errs.filter((e) => e.plausible && e.cat1dom));
  console.log(`\n${"═".repeat(72)}`);
  console.log(`INTERCEPT ${intercept}  (nieuwe beeld-scores + ontkoppeld cat2/3 €900/€500)`);
  console.log(`  Alle (n=${all.n}):           mediaan ${pct(all.med)}  gem ${pct(all.mae)}  <15% ${all.w15}/${all.n}  <20% ${all.w20}/${all.n}`);
  console.log(`  Plausibel (n=${plaus.n}):       mediaan ${pct(plaus.med)}  gem ${pct(plaus.mae)}  <15% ${plaus.w15}/${plaus.n}`);
  console.log(`  Cat1-dom plausibel (n=${c1.n}): mediaan ${pct(c1.med)}  gem ${pct(c1.mae)}  <15% ${c1.w15}/${c1.n}`);
}

console.log(`\n${"═".repeat(72)}`);
console.log("Vergelijking met huidige live (oude scores + int 1.28 + ontkoppeld): alle mediaan +19.2%, cat1-dom +6.8%");
