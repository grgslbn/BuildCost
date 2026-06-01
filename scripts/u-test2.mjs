/**
 * u-test2.mjs — does a clean binary "small-units" flag improve building-level
 * prediction (vs the continuous size models that overfit)?
 */
import { readFileSync } from "node:fs";

const byRef = {};
for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m; const d = desc.toLowerCase();
  if (!/appartement/.test(d)) continue;
  if (/meerprijs|kelder|garage|berging|entree|tussenvloer|gemene|parking|technieken|zolder|inrichting|magazijn|kantoor|handel/.test(d)) continue;
  const size = +opp, price = +e; if (size < 25 || size > 500 || price < 1400 || price > 3800) continue;
  (byRef[ref] ??= { sizes: [], prices: [] }); byRef[ref].sizes.push(size); byRef[ref].prices.push(price);
}
const B = Object.entries(byRef).map(([ref, v]) => ({
  ref, eur: [...v.prices].sort((a, b) => a - b)[Math.floor(v.prices.length / 2)],
  avg: v.sizes.reduce((a, b) => a + b, 0) / v.sizes.length,
}));
console.log(`Appartementsgebouwen: ${B.length}`);
const small = B.filter(b => b.avg < 85), rest = B.filter(b => b.avg >= 85);
console.log(`  kleine-units (<85 m² gem.): ${small.length}  |  rest: ${rest.length}`);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`  gem €/m²:  klein €${Math.round(mean(small.map(b=>b.eur)))}  vs  rest €${Math.round(mean(rest.map(b=>b.eur)))}\n`);

// CV: constant vs two-group (small/rest means)
const y = B.map(b => b.eur);
const meanMAE = () => { const m = mean(y); return mean(y.map(v => Math.abs(v - m))); };
function cvTwoGroup(folds = 5) {
  let e = 0, c = 0;
  for (let f = 0; f < folds; f++) {
    const tr = B.filter((_, i) => i % folds !== f), te = B.filter((_, i) => i % folds === f);
    const mS = mean(tr.filter(b => b.avg < 85).map(b => b.eur)) || mean(tr.map(b => b.eur));
    const mR = mean(tr.filter(b => b.avg >= 85).map(b => b.eur)) || mean(tr.map(b => b.eur));
    for (const b of te) { e += Math.abs((b.avg < 85 ? mS : mR) - b.eur); c++; }
  }
  return e / c;
}
console.log("Model                          CV MAE €/m²");
console.log(`  constant (gemiddelde)        €${Math.round(meanMAE())}`);
console.log(`  twee groepen (klein/rest)    €${Math.round(cvTwoGroup())}`);

// also: MAE only on the small-unit buildings (does the flag help THEM?)
function cvSmallOnly(folds = 5) {
  let eC = 0, eG = 0, c = 0;
  for (let f = 0; f < folds; f++) {
    const tr = B.filter((_, i) => i % folds !== f), te = B.filter((_, i) => i % folds === f).filter(b => b.avg < 85);
    const mAll = mean(tr.map(b => b.eur));
    const mS = mean(tr.filter(b => b.avg < 85).map(b => b.eur)) || mAll;
    for (const b of te) { eC += Math.abs(mAll - b.eur); eG += Math.abs(mS - b.eur); c++; }
  }
  return { constant: eC / c, grouped: eG / c, n: c };
}
const s = cvSmallOnly();
console.log(`\nEnkel op de kleine-units-gebouwen (n≈${s.n}):`);
console.log(`  constante voorspelling   MAE €${Math.round(s.constant)}`);
console.log(`  groep-voorspelling       MAE €${Math.round(s.grouped)}   → ${s.grouped<s.constant?`BETER met €${Math.round(s.constant-s.grouped)}`:"niet beter"}`);
