/**
 * model-combined.mjs — does adding finish-QQPs ON TOP of type+mix help?
 * On the 31 dossiers that have QQP scores, compares:
 *   constant | type-base only | type+mix | finish-only | type+mix+finish (combined)
 * type-base prior comes from the 431-model means.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); }
function ridge(X, y, lambda) { const n = X.length, k = X[0].length; const xb = Array(k).fill(0); let yb = 0; for (let i = 0; i < n; i++) { yb += y[i] / n; for (let j = 0; j < k; j++) xb[j] += X[i][j] / n; } const A = Array.from({ length: k }, () => Array(k).fill(0)), b = Array(k).fill(0); for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { const xa = X[i][a] - xb[a]; b[a] += xa * (y[i] - yb); for (let c = 0; c < k; c++) A[a][c] += xa * (X[i][c] - xb[c]); } for (let a = 0; a < k; a++) A[a][a] += lambda; const w = solve(A, b); const b0 = yb - xb.reduce((s, v, j) => s + v * w[j], 0); return { w, b0 }; }
const clamp = (f) => Math.max(0.70, Math.min(1.50, f));
const pred = (x, m) => clamp(m.b0 + x.reduce((s, v, j) => s + v * m.w[j], 0));
function cvMAE(X, y, lambdas, folds = 5) { let best = Infinity; for (const lam of lambdas) { let e = 0, c = 0; for (let f = 0; f < folds; f++) { const Xtr = [], ytr = [], Xte = [], yte = []; X.forEach((r, i) => { (i % folds === f ? Xte : Xtr).push(r); (i % folds === f ? yte : ytr).push(y[i]); }); if (Xtr.length < 4) continue; const m = ridge(Xtr, ytr, lam); Xte.forEach((r, i) => { e += Math.abs(pred(r, m) - yte[i]); c++; }); } best = Math.min(best, e / c); } return best; }
const meanMAE = (y) => { const m = y.reduce((a, b) => a + b) / y.length; return y.reduce((s, v) => s + Math.abs(v - m), 0) / y.length; };
const LAM = [0.05, 0.1, 0.3, 1, 3, 10];

// type prior from the 431 model
const TYPE_BASE = { luxe: 1.28, woning: 1.16, appartement: 1.04, horeca: 1.04, commercieel: 0.91, overig: 1.04 };
const descByRef = {};
for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) { const m = r.match(/^([^,]+),[^,]+,"(.*)",/); if (m) (descByRef[m[1]] ??= []).push(m[2].toLowerCase()); }
function typeOf(ref) { const d = (descByRef[ref] || []).join(" "); if (/villa|hotel|wellness|zwembad|sauna/.test(d)) return "luxe"; if (/restaurant|brasserie|caf[eé]|horeca|taverne|frituur/.test(d)) return "horeca"; if (/kantoor|handel|winkel|showroom|magazijn|atelier|werkplaats|industrie|loods|praktijk|opslag/.test(d)) return "commercieel"; if (/appartement/.test(d)) return "appartement"; if (/woning|woonhuis|gezinswoning|hoeve|boerderij/.test(d)) return "woning"; return "overig"; }
const targets = {};
for (const r of readFileSync("scripts/expert-f-targets.csv", "utf8").split("\n").slice(1).filter(Boolean)) { const [ref, c1, c2, c3, , f] = r.split(","); const tot = +c1 + +c2 + +c3; targets[ref] = { cat2_frac: +c2 / tot, cat3_frac: +c3 / tot, f: +f }; }

const map = readFileSync("scripts/trainset-runmap.csv", "utf8").split("\n").slice(1).filter(Boolean).map((r) => { const [ref, , est] = r.split(","); return { ref, est }; });
const rows = [];
for (const m of map) { const r = await fetch(`${URL}/rest/v1/estimations?select=status,extracted_qqps&id=eq.${m.est}`, { headers: H }); const row = (await r.json())[0]; const t = targets[m.ref]; if (row?.status === "complete" && row.extracted_qqps && t) { const q = row.extracted_qqps; const sc = (n) => (typeof q[n]?.score === "number" ? q[n].score : 0); rows.push({ ref: m.ref, f: t.f, base: TYPE_BASE[typeOf(m.ref)] ?? 1.04, cat2_frac: t.cat2_frac, cat3_frac: t.cat3_frac, bath: sc("bathroom_luxury_score"), island: sc("has_kitchen_island"), storage: sc("built_in_storage_count"), terras: sc("terrace_balcony_sqm") }); } }

const y = rows.map((r) => r.f);
console.log(`n = ${rows.length}\n`);
console.log(`constant baseline           MAE F = ${meanMAE(y).toFixed(3)}`);
console.log(`type-base only              MAE F = ${cvMAE(rows.map(r=>[r.base]), y, LAM).toFixed(3)}`);
console.log(`type-base + mix             MAE F = ${cvMAE(rows.map(r=>[r.base,r.cat2_frac,r.cat3_frac]), y, LAM).toFixed(3)}`);
console.log(`finish-only (4)             MAE F = ${cvMAE(rows.map(r=>[r.bath,r.island,r.storage,r.terras]), y, LAM).toFixed(3)}`);
console.log(`COMBINED type+mix+finish    MAE F = ${cvMAE(rows.map(r=>[r.base,r.cat2_frac,r.cat3_frac,r.bath,r.island,r.storage,r.terras]), y, LAM).toFixed(3)}`);

// fit combined on all, show coefficients
const X = rows.map(r=>[r.base,r.cat2_frac,r.cat3_frac,r.bath,r.island,r.storage,r.terras]);
const m = ridge(X, y, 1);
const names = ["type_base","cat2_frac","cat3_frac","bathroom_luxe","keuken_eiland","inbouwkasten","terras_qqp"];
console.log("\nCombined coëfficiënten (lambda=1):  intercept", m.b0.toFixed(3));
names.forEach((n,i)=>console.log(`  ${n.padEnd(16)} ${m.w[i].toFixed(3)}`));
