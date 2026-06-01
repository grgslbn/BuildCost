/**
 * refit-f.mjs — collect QQP features from the trainset runs and refit the
 * ridge F-model on the real expert-F targets.
 *
 * Reads trainset-runmap.csv, fetches estimations.extracted_qqps + status,
 * builds (X = QQP scores, y = expert_f), 5-fold CV ridge fit, prints the new
 * intercept + weights and CV MAE. Writes scripts/proposed-model.json.
 * Does NOT activate the model — review first.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const map = readFileSync("scripts/trainset-runmap.csv", "utf8").split("\n").slice(1).filter(Boolean)
  .map((r) => { const [ref, dossier_id, est, f] = r.split(","); return { ref, est, f: +f }; });

// fetch each estimation
const data = [];
for (const m of map) {
  const r = await fetch(`${URL}/rest/v1/estimations?select=status,extracted_qqps&id=eq.${m.est}`, { headers: H });
  const row = (await r.json())[0];
  if (!row) continue;
  data.push({ ...m, status: row.status, qqps: row.extracted_qqps });
}
const done = data.filter((d) => d.status === "complete" && d.qqps && Object.keys(d.qqps).length > 0);
const errored = data.filter((d) => d.status === "error");
const pending = data.filter((d) => d.status !== "complete" && d.status !== "error");
console.log(`Runmap: ${map.length} | complete+qqp: ${done.length} | error: ${errored.length} | nog bezig: ${pending.length}`);
if (pending.length) console.log("  (nog bezig — wacht tot alles klaar is voor de definitieve fit)");
if (done.length < 12) { console.log("Te weinig datapunten voor een betrouwbare fit (min ~12)."); process.exit(0); }

// feature set = union of qqp names
const names = [...new Set(done.flatMap((d) => Object.keys(d.qqps)))].sort();
const X = done.map((d) => names.map((n) => (typeof d.qqps[n]?.score === "number" ? d.qqps[n].score : 0)));
const y = done.map((d) => d.f);

// ── ridge fit (penalize weights, not intercept) ──
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i][i] ?? 0).map((v, i) => M[i][n] / M[i][i]);
}
function ridgeFit(Xtr, ytr, lambda) {
  const n = Xtr.length, k = Xtr[0].length;
  const xbar = Array(k).fill(0); let ybar = 0;
  for (let i = 0; i < n; i++) { ybar += ytr[i] / n; for (let j = 0; j < k; j++) xbar[j] += Xtr[i][j] / n; }
  const A = Array.from({ length: k }, () => Array(k).fill(0)), bb = Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) {
    const xa = Xtr[i][a] - xbar[a];
    bb[a] += xa * (ytr[i] - ybar);
    for (let c = 0; c < k; c++) A[a][c] += xa * (Xtr[i][c] - xbar[c]);
  }
  for (let a = 0; a < k; a++) A[a][a] += lambda;
  const w = solve(A, bb);
  const b0 = ybar - xbar.reduce((s, xb, j) => s + xb * w[j], 0);
  return { w, b0 };
}
const predict = (x, m) => Math.max(0.70, Math.min(1.50, m.b0 + x.reduce((s, v, j) => s + v * m.w[j], 0)));

// 5-fold CV over lambda grid
const lambdas = [0.05, 0.1, 0.3, 1, 3, 10, 30, 100];
const folds = 5;
let best = { lambda: 1, mae: Infinity };
for (const lambda of lambdas) {
  let err = 0, cnt = 0;
  for (let f = 0; f < folds; f++) {
    const Xtr = [], ytr = [], Xte = [], yte = [];
    X.forEach((row, i) => { if (i % folds === f) { Xte.push(row); yte.push(y[i]); } else { Xtr.push(row); ytr.push(y[i]); } });
    if (Xtr.length < 5) continue;
    const m = ridgeFit(Xtr, ytr, lambda);
    Xte.forEach((row, i) => { err += Math.abs(predict(row, m) - yte[i]); cnt++; });
  }
  const mae = err / cnt;
  console.log(`  lambda=${lambda}: CV MAE F = ${mae.toFixed(3)}`);
  if (mae < best.mae) best = { lambda, mae };
}
console.log(`\nBeste lambda=${best.lambda} (CV MAE F=${best.mae.toFixed(3)})`);

// final fit on all data
const model = ridgeFit(X, y, best.lambda);
const weights = {};
names.forEach((n, j) => { weights[n] = model.w[j]; });
const trainMae = X.reduce((s, row, i) => s + Math.abs(predict(row, model) - y[i]), 0) / X.length;
console.log(`Train MAE F = ${trainMae.toFixed(3)} | intercept = ${model.b0.toFixed(3)}`);
console.log("\nTop gewichten:");
Object.entries(weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 15)
  .forEach(([n, w]) => console.log(`  ${n.padEnd(30)} ${w.toFixed(4)}`));

writeFileSync("scripts/proposed-model.json", JSON.stringify({ intercept: model.b0, weights, lambda: best.lambda, n: done.length, cv_mae: best.mae }, null, 2));
console.log("\nVoorstel weggeschreven: scripts/proposed-model.json (NIET geactiveerd — eerst reviewen)");
