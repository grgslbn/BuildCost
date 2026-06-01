/**
 * expert-f.mjs — per-dossier expert F (the retrain TARGET), from harvested lines.
 *
 * Reads scripts/harvest-prices.csv (ref,cat,desc,opp,waarde,eur_per_m2),
 * aggregates m² + building cost per category per dossier (equipment lines have
 * no opp → already excluded), then back-calculates the F our model would need
 * to reproduce the expert's per-m² cost, given the CURRENT price settings.
 *
 * Approximation: regional = abex = 1.0 (most ABEX ~1056 ≈ 1.0; regional 0.92-1.0).
 * This yields the F-target distribution to (a) set the intercept and (b) retrain.
 */
import { readFileSync, writeFileSync } from "node:fs";

// current settings (we are NOT changing prices)
const P = { cat1_min: 1600, cat1_max: 2900, cat2_min: 900, cat2_max: 1500, cat3_min: 500, cat3_max: 900 };
const F_MIN = 0.70, F_MAX = 1.50;

const rows = readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean);
const byRef = {};
for (const r of rows) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/);
  if (!m) continue;
  const [, ref, cat, , opp, waarde] = m;
  if (!["cat1", "cat2", "cat3"].includes(cat)) continue;
  byRef[ref] ??= { cat1: 0, cat2: 0, cat3: 0, cost1: 0, cost2: 0, cost3: 0 };
  byRef[ref][cat] += Number(opp);
  byRef[ref]["cost" + cat.slice(3)] += Number(waarde);
}

function backcalcF(a1, a2, a3, cost) {
  const minCost = a1 * P.cat1_min + a2 * P.cat2_min + a3 * P.cat3_min;
  const slope = a1 * (P.cat1_max - P.cat1_min) + a2 * (P.cat2_max - P.cat2_min) + a3 * (P.cat3_max - P.cat3_min);
  if (slope <= 0) return null;
  const r = (cost - minCost) / slope;
  const rawF = F_MIN + r * (F_MAX - F_MIN);
  return { f: Math.max(F_MIN, Math.min(F_MAX, rawF)), rawF };
}

const out = [];
for (const [ref, d] of Object.entries(byRef)) {
  const cost = d.cost1 + d.cost2 + d.cost3;
  const area = d.cat1 + d.cat2 + d.cat3;
  if (area < 20 || cost < 20000) continue; // skip noise/fragments
  const bc = backcalcF(d.cat1, d.cat2, d.cat3, cost);
  if (!bc) continue;
  out.push({ ref, cat1: Math.round(d.cat1), cat2: Math.round(d.cat2), cat3: Math.round(d.cat3), cost: Math.round(cost), f: bc.f, rawF: bc.rawF });
}

const fs = out.map((o) => o.f).sort((a, b) => a - b);
const raw = out.map((o) => o.rawF).sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

console.log(`Dossiers met bruikbare expert-data: ${out.length}`);
console.log("\n=== Expert F (geklemd 0.70-1.50), met huidige prijzen [1600/2900, 900/1500, 500/900] ===");
console.log(`min ${fs[0].toFixed(2)} | p10 ${q(fs,.1).toFixed(2)} | p25 ${q(fs,.25).toFixed(2)} | MEDIAAN ${q(fs,.5).toFixed(2)} | p75 ${q(fs,.75).toFixed(2)} | p90 ${q(fs,.9).toFixed(2)} | max ${fs[fs.length-1].toFixed(2)}`);
console.log(`GEMIDDELDE F = ${mean(fs).toFixed(3)}  <-- intercept-doel`);
console.log(`(ongeklemd rawF: mediaan ${q(raw,.5).toFixed(2)}, gemiddelde ${mean(raw).toFixed(2)}, %>1.50 = ${Math.round(100*raw.filter(x=>x>1.5).length/raw.length)}%, %<0.70 = ${Math.round(100*raw.filter(x=>x<0.7).length/raw.length)}%)`);

// histogram clamped F (0.1 buckets)
console.log("\n=== Expert F histogram (0.10 buckets) ===");
const buckets = {};
for (const f of fs) { const b = (Math.floor(f * 10) / 10).toFixed(1); buckets[b] = (buckets[b] || 0) + 1; }
for (const b of Object.keys(buckets).sort()) console.log(`  F ${b}: ${"#".repeat(Math.ceil(buckets[b]/3))} (${buckets[b]})`);

// write per-dossier target CSV
const csv = ["ref,cat1_m2,cat2_m2,cat3_m2,building_cost,expert_f,raw_f"];
for (const o of out.sort((a,b)=>a.f-b.f)) csv.push(`${o.ref},${o.cat1},${o.cat2},${o.cat3},${o.cost},${o.f.toFixed(3)},${o.rawF.toFixed(3)}`);
writeFileSync("scripts/expert-f-targets.csv", csv.join("\n"));
console.log(`\nTarget CSV: scripts/expert-f-targets.csv (${out.length} dossiers)`);
