/**
 * model-explore.mjs
 *  (1) type+mix model on 431 dossiers (cheap SQM-available features) — CV MAE.
 *  (2) curated finish-QQP ridge on the 31 with QQP scores — CV MAE (answer to "A").
 * Compares both to the constant baseline.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// ---- linear algebra ----
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function ridge(X, y, lambda) { // with unpenalized intercept (bias via centering)
  const n = X.length, k = X[0].length; const xb = Array(k).fill(0); let yb = 0;
  for (let i = 0; i < n; i++) { yb += y[i] / n; for (let j = 0; j < k; j++) xb[j] += X[i][j] / n; }
  const A = Array.from({ length: k }, () => Array(k).fill(0)), b = Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { const xa = X[i][a] - xb[a]; b[a] += xa * (y[i] - yb); for (let c = 0; c < k; c++) A[a][c] += xa * (X[i][c] - xb[c]); }
  for (let a = 0; a < k; a++) A[a][a] += lambda;
  const w = solve(A, b); const b0 = yb - xb.reduce((s, v, j) => s + v * w[j], 0); return { w, b0 };
}
const clamp = (f) => Math.max(0.70, Math.min(1.50, f));
const pred = (x, m) => clamp(m.b0 + x.reduce((s, v, j) => s + v * m.w[j], 0));
function cvMAE(X, y, lambda, folds = 5) {
  let e = 0, c = 0;
  for (let f = 0; f < folds; f++) { const Xtr = [], ytr = [], Xte = [], yte = []; X.forEach((r, i) => { (i % folds === f ? Xte : Xtr).push(r); (i % folds === f ? yte : ytr).push(y[i]); }); if (Xtr.length < 4) continue; const m = ridge(Xtr, ytr, lambda); Xte.forEach((r, i) => { e += Math.abs(pred(r, m) - yte[i]); c++; }); }
  return e / c;
}
const meanMAE = (y) => { const m = y.reduce((a, b) => a + b) / y.length; return y.reduce((s, v) => s + Math.abs(v - m), 0) / y.length; };

// ---- load 431: type + mix ----
const targets = {};
for (const r of readFileSync("scripts/expert-f-targets.csv", "utf8").split("\n").slice(1).filter(Boolean)) { const [ref, c1, c2, c3, , f] = r.split(","); targets[ref] = { cat1: +c1, cat2: +c2, cat3: +c3, f: +f }; }
const descByRef = {};
for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) { const m = r.match(/^([^,]+),[^,]+,"(.*)",/); if (m) (descByRef[m[1]] ??= []).push(m[2].toLowerCase()); }
const TYPES = ["luxe", "woning", "appartement", "horeca", "commercieel", "overig"];
function typeOf(ref) { const d = (descByRef[ref] || []).join(" ");
  if (/villa|hotel|wellness|zwembad|sauna/.test(d)) return "luxe";
  if (/restaurant|brasserie|caf[eé]|horeca|taverne|frituur/.test(d)) return "horeca";
  if (/kantoor|handel|winkel|showroom|magazijn|atelier|werkplaats|industrie|loods|praktijk|opslag/.test(d)) return "commercieel";
  if (/appartement/.test(d)) return "appartement";
  if (/woning|woonhuis|gezinswoning|hoeve|boerderij/.test(d)) return "woning";
  return "overig"; }

const big = Object.entries(targets).filter(([, t]) => t.cat1 + t.cat2 + t.cat3 >= 20)
  .map(([ref, t]) => { const tot = t.cat1 + t.cat2 + t.cat3; return { ref, f: t.f, type: typeOf(ref), cat2_frac: t.cat2 / tot, cat3_frac: t.cat3 / tot }; });
const Xtm = big.map((r) => [...TYPES.map((t) => (r.type === t ? 1 : 0)), r.cat2_frac, r.cat3_frac]);
const ytm = big.map((r) => r.f);

console.log(`(1) TYPE + MIX model — n=${big.length}`);
console.log(`    constante baseline MAE F = ${meanMAE(ytm).toFixed(3)}`);
for (const lam of [0.01, 0.05, 0.1, 0.3, 1]) console.log(`    type+mix  lambda=${lam}: CV MAE F = ${cvMAE(Xtm, ytm, lam).toFixed(3)}`);
// coefficients
const mtm = ridge(Xtm, ytm, 0.05);
console.log("    type-basis F (intercept+coef):");
TYPES.forEach((t, i) => console.log(`      ${t.padEnd(12)} ${(mtm.b0 + mtm.w[i]).toFixed(2)}`));
console.log(`      cat2_frac coef ${mtm.w[6].toFixed(2)}  cat3_frac coef ${mtm.w[7].toFixed(2)}`);

// ---- (2) curated finish-QQP ridge on the 31 ----
const FINISH = ["bathroom_luxury_score", "has_kitchen_island", "kitchen_appliance_count", "built_in_storage_count", "has_fireplace", "has_wellness", "has_dressing", "bathroom_per_bedroom_ratio", "kitchen_sqm", "largest_bathroom_sqm"];
const map = readFileSync("scripts/trainset-runmap.csv", "utf8").split("\n").slice(1).filter(Boolean).map((r) => { const [ref, , est, f] = r.split(","); return { ref, est, f: +f }; });
const rows = [];
for (const m of map) { const r = await fetch(`${URL}/rest/v1/estimations?select=status,extracted_qqps&id=eq.${m.est}`, { headers: H }); const row = (await r.json())[0]; if (row?.status === "complete" && row.extracted_qqps) rows.push({ ...m, q: row.extracted_qqps }); }
const Xq = rows.map((r) => FINISH.map((n) => (typeof r.q[n]?.score === "number" ? r.q[n].score : 0)));
const yq = rows.map((r) => r.f);
console.log(`\n(2) Gecurateerd finish-QQP model (A) — n=${rows.length}, ${FINISH.length} features`);
console.log(`    constante baseline MAE F = ${meanMAE(yq).toFixed(3)}`);
for (const lam of [0.05, 0.1, 0.3, 1, 3, 10]) console.log(`    finish-QQP lambda=${lam}: CV MAE F = ${cvMAE(Xq, yq, lam).toFixed(3)}`);
