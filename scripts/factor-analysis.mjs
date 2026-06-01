/**
 * factor-analysis.mjs — which CHEAP factors predict expert F? (n=431)
 * Joins expert-f-targets.csv (areas + F) with harvest-prices.csv (descriptions
 * → building type) and tests correlations + group means.
 */
import { readFileSync } from "node:fs";

// per-dossier areas + F
const targets = {};
for (const r of readFileSync("scripts/expert-f-targets.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
  const [ref, c1, c2, c3, cost, f] = r.split(",");
  targets[ref] = { cat1: +c1, cat2: +c2, cat3: +c3, cost: +cost, f: +f };
}
// per-dossier concatenated descriptions
const descByRef = {};
for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",/); if (!m) continue;
  (descByRef[m[1]] ??= []).push(m[3].toLowerCase());
}

function classifyType(descs) {
  const d = descs.join(" ");
  if (/villa|hotel|wellness|zwembad|sauna|luxe/.test(d)) return "luxe/villa/hotel";
  if (/restaurant|brasserie|caf[eé]|horeca|taverne|frituur/.test(d)) return "horeca";
  if (/kantoor|handel|winkel|showroom|magazijn|atelier|werkplaats|industrie|loods|praktijk|garage verhuur|opslag/.test(d)) return "commercieel";
  if (/appartement/.test(d)) return "appartement";
  if (/woning|woonhuis|gezinswoning|villa|hoeve|boerderij/.test(d)) return "woning";
  return "overig";
}

const rows = [];
for (const [ref, t] of Object.entries(targets)) {
  const total = t.cat1 + t.cat2 + t.cat3;
  if (total < 20) continue;
  rows.push({
    ref, f: t.f, total,
    cat1_frac: t.cat1 / total, cat2_frac: t.cat2 / total, cat3_frac: t.cat3 / total,
    logTotal: Math.log(total),
    type: classifyType(descByRef[ref] || []),
  });
}
console.log(`n = ${rows.length}\n`);

function pearson(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
const F = rows.map((r) => r.f);
console.log("=== Correlatie (Pearson r) met expert-F ===");
for (const feat of ["total", "logTotal", "cat1_frac", "cat2_frac", "cat3_frac"]) {
  console.log(`  ${feat.padEnd(12)} r = ${pearson(rows.map((r) => r[feat]), F).toFixed(3)}`);
}

console.log("\n=== Gemiddelde expert-F per gebouwtype ===");
const types = {};
for (const r of rows) (types[r.type] ??= []).push(r.f);
for (const [t, arr] of Object.entries(types).sort((a, b) => b[1].reduce((s, x) => s + x, 0) / b[1].length - a[1].reduce((s, x) => s + x, 0) / a[1].length)) {
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const sorted = [...arr].sort((a, b) => a - b);
  console.log(`  ${t.padEnd(18)} n=${String(arr.length).padStart(3)}  gem F=${mean.toFixed(2)}  (mediaan ${sorted[Math.floor(sorted.length / 2)].toFixed(2)})`);
}

console.log("\n=== F per oppervlakte-klasse ===");
const bins = [[0,150],[150,300],[300,600],[600,1200],[1200,1e9]];
for (const [lo,hi] of bins) {
  const a = rows.filter((r)=>r.total>=lo&&r.total<hi).map((r)=>r.f);
  if (!a.length) continue;
  console.log(`  ${lo}-${hi===1e9?"∞":hi} m²: n=${String(a.length).padStart(3)} gem F=${(a.reduce((s,x)=>s+x,0)/a.length).toFixed(2)}`);
}
