/**
 * pick-trainset.mjs — select a training subset for the F retrain.
 * Joins expert-f-targets.csv (ref -> expert F) with plan file sizes,
 * keeps dossiers with a real plan (>2MB), and spreads the selection
 * across F buckets so the model learns the full basic..luxury range.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] || "C:/Users/tieme/Mijn Drive/M²Value/field/ALL/SPLIT_V2";
const PER_BUCKET = Number(process.argv[3] || 10);

// plan sizes by ref
const planSize = {};
for (const f of readdirSync(DIR)) {
  const m = f.match(/^(.+)_Plannen\.pdf$/i);
  if (m) planSize[m[1]] = statSync(join(DIR, f)).size;
}

// targets
const rows = readFileSync("scripts/expert-f-targets.csv", "utf8").split("\n").slice(1).filter(Boolean);
const items = rows.map((r) => {
  const [ref, cat1, cat2, cat3, cost, f] = r.split(",");
  return { ref, cat1: +cat1, cat2: +cat2, cat3: +cat3, cost: +cost, f: +f, mb: (planSize[ref] || 0) / 1e6 };
}).filter((x) => x.mb >= 2);   // only dossiers with a real architectural plan

const buckets = [
  { name: "F<0.80 (basis)", lo: 0, hi: 0.80 },
  { name: "0.80-0.95",      lo: 0.80, hi: 0.95 },
  { name: "0.95-1.10 (gem)",lo: 0.95, hi: 1.10 },
  { name: "1.10-1.30",      lo: 1.10, hi: 1.30 },
  { name: "F>1.30 (luxe)",  lo: 1.30, hi: 99 },
];

const picked = [];
console.log(`Dossiers met target + plan >2MB: ${items.length}\n`);
for (const b of buckets) {
  const inB = items.filter((x) => x.f >= b.lo && x.f < b.hi).sort((a, c) => c.mb - a.mb);
  const take = inB.slice(0, PER_BUCKET);
  picked.push(...take);
  console.log(`${b.name}: ${inB.length} beschikbaar -> ${take.length} gekozen`);
  for (const t of take) console.log(`   ${t.ref}  F=${t.f.toFixed(2)}  cat1=${t.cat1} cat2=${t.cat2} cat3=${t.cat3}  plan ${t.mb.toFixed(1)}MB`);
}

const csv = ["ref,expert_f,cat1_m2,cat2_m2,cat3_m2,building_cost,plan_mb"];
for (const t of picked) csv.push(`${t.ref},${t.f.toFixed(3)},${t.cat1},${t.cat2},${t.cat3},${t.cost},${t.mb.toFixed(1)}`);
writeFileSync("scripts/trainset.csv", csv.join("\n"));
console.log(`\nTotaal gekozen: ${picked.length} -> scripts/trainset.csv`);
