/**
 * apartment-analysis.mjs — within-apartment drivers of €/m².
 * Uses the cheap signals already in the berekeningen: per-apartment SIZE (opp)
 * vs the expert €/m². Are bigger apartments priced higher per m² (luxe)?
 */
import { readFileSync } from "node:fs";

const rows = readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean);
const apt = [];
for (const r of rows) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/);
  if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m;
  const d = desc.toLowerCase();
  if (cat !== "cat1") continue;
  if (!/appartement/.test(d)) continue;
  if (/meerprijs|kelder|garage|berging|entree|tussenvloer|gemene|parking|technieken|zolder|inrichting/.test(d)) continue;
  const size = Number(opp), price = Number(e);
  if (size < 25 || size > 400 || price < 1200 || price > 4000) continue; // plausible single-apartment lines
  apt.push({ ref, size, price });
}

function pearson(xs, ys) { const n = xs.length, mx = xs.reduce((a,b)=>a+b)/n, my = ys.reduce((a,b)=>a+b)/n; let sxy=0,sxx=0,syy=0; for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;sxy+=dx*dy;sxx+=dx*dx;syy+=dy*dy;} return sxy/Math.sqrt(sxx*syy); }

console.log(`Appartement-woonregels (plausibel): n=${apt.length}`);
console.log(`Correlatie grootte ↔ €/m²:  r = ${pearson(apt.map(a=>a.size), apt.map(a=>a.price)).toFixed(3)}\n`);

console.log("=== €/m² per grootte-klasse ===");
const bins = [[25,60],[60,90],[90,120],[120,160],[160,250],[250,400]];
for (const [lo,hi] of bins) {
  const a = apt.filter(x=>x.size>=lo&&x.size<hi).map(x=>x.price);
  if (!a.length) continue;
  const mean = Math.round(a.reduce((s,x)=>s+x,0)/a.length);
  const sd = Math.round(Math.sqrt(a.reduce((s,x)=>s+(x-mean)**2,0)/a.length));
  console.log(`  ${lo}-${hi} m²: n=${String(a.length).padStart(3)}  gem €/m²=${mean}  (spreiding ±${sd})`);
}

// within-building spread: do apartments in the same building share a rate?
const byRef = {};
for (const a of apt) (byRef[a.ref] ??= []).push(a.price);
const multi = Object.entries(byRef).filter(([,v])=>v.length>=2);
let sameRate=0, varies=0;
for (const [,v] of multi){ const mn=Math.min(...v),mx=Math.max(...v); if((mx-mn)/mn<0.05) sameRate++; else varies++; }
console.log(`\n=== Binnen hetzelfde gebouw (${multi.length} gebouwen met >=2 app-regels) ===`);
console.log(`  zelfde €/m² (<5% verschil): ${sameRate}  |  varieert: ${varies}`);
console.log("  => " + (sameRate>varies ? "expert hanteert meestal ÉÉN €/m² per gebouw (verschil zit TUSSEN gebouwen)" : "varieert ook binnen gebouw"));
