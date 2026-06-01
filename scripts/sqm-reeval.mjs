/**
 * sqm-reeval.mjs — recompute the expert ground truth with INCLUSIVE heated-floor
 * classification (cat1 = all heated/finished floor: apartments + commercial GF +
 * offices + common/circulation), then re-evaluate the footprint measurement
 * (sqm-measure.json) against the corrected ground truth.
 */
import { readFileSync, writeFileSync } from "node:fs";

const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"));
const meas = JSON.parse(readFileSync("scripts/sqm-measure.json", "utf8"));

// INCLUSIVE heated-floor classifier (what the building footprint actually contains)
function heatedFloor(rows) {
  let m2 = 0, val = 0;
  for (const r of rows || []) {
    const d = (r.omschrijving || "").toLowerCase();
    const opp = typeof r.opp_m2 === "number" ? r.opp_m2 : 0;
    if (!opp) continue;
    if (/terras|balkon|dakterras|groendak/.test(d)) continue;            // cat3 outdoor
    if (/kelder|garage|berging|parking|staanplaats|fietsen|afval|techni|inrit|hellingsbaan/.test(d)) continue; // cat2
    // everything else with an area = heated finished floor (woon/handels/kantoor/restaurant/gelijkvloers/gemeen/...)
    m2 += opp; val += (r.waarde_eur || 0);
  }
  return { m2, val, eur: m2 ? Math.round(val / m2) : null };
}

// recompute + store corrected ground truth
const gt = {};
for (const d of bench) {
  const h = heatedFloor(d.rows);
  gt[d.ref] = { heated_m2: Math.round(h.m2), heated_eur: h.eur, strict_cat1: Math.round(d.cats.cat1.opp), total: d.total };
}
writeFileSync("scripts/sqm-groundtruth.json", JSON.stringify(gt, null, 1));

console.log("══ Footprint-meting vs GECORRIGEERDE grondwaarheid (verwarmde vloer) ══\n");
console.log("dossier      pred    strict-cat1  heated-floor   Δ(strict)  Δ(heated)");
let maeS = [], maeH = [];
for (const m of meas) {
  const g = gt[m.ref]; if (!g || !m.grossPred) continue;
  const dS = m.grossPred / g.strict_cat1 - 1;
  const dH = m.grossPred / g.heated_m2 - 1;
  maeS.push(Math.abs(dS)); maeH.push(Math.abs(dH));
  console.log(`${m.ref}  ${String(m.grossPred).padStart(6)}  ${String(g.strict_cat1).padStart(8)}     ${String(g.heated_m2).padStart(8)}      ${(dS*100>=0?"+":"")+(dS*100).toFixed(0)+"%"}      ${(dH*100>=0?"+":"")+(dH*100).toFixed(0)+"%"}`);
}
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`\nmediaan-|Δ| vs strict-cat1: ${(med(maeS)*100).toFixed(0)}%   vs heated-floor: ${(med([...maeH])*100).toFixed(0)}%`);
console.log("(heated-floor = wat de footprint-meting hoort te benaderen)");

// also: heated €/m² distribution (the real woon-equivalent price)
const eurs = Object.values(gt).map((g) => g.heated_eur).filter((x) => x && x > 1000 && x < 4000).sort((a, b) => a - b);
console.log(`\nHeated-floor €/m² (n=${eurs.length}): mediaan €${eurs[Math.floor(eurs.length/2)]}  range €${eurs[0]}–€${eurs[eurs.length-1]}`);
