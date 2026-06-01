/**
 * bench-pricing.mjs — validate the cat2/cat3 decoupled-basis fix against expert data.
 * For each apartment dossier: compare the expert cat2/cat3 value vs PlanBase
 * OLD (cat2 €900 / cat3 €500 = min) and NEW (cat2 €1100 / cat3 €900 = basis P50).
 * Also the full m²-subtotal error (using expert woon €/m² so cat1 is isolated).
 */
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"));
const apt = data.filter((d) => /appartement/i.test(d.building_type || "") && d.cats.cat1.opp > 50 && d.woonEur);

const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
const eur = (n) => "€" + Math.round(n).toLocaleString("nl-BE");

// cat2/cat3 prediction accuracy: OLD (min) vs NEW (basis)
function cat23err(price2, price3) {
  let absErr = 0, n = 0;
  for (const d of apt) {
    const exp = d.cats.cat2.val + d.cats.cat3.val;
    if (exp < 1000) continue;
    const pred = d.cats.cat2.opp * price2 + d.cats.cat3.opp * price3;
    absErr += Math.abs(pred - exp); n++;
  }
  return { mae: absErr / n, n };
}
const oldE = cat23err(900, 500), newE = cat23err(1100, 900);
console.log("══ cat2/cat3 prijs-fix (expert cat2+cat3 waarde vs PlanBase) ══");
console.log(`  OUD (cat2 €900, cat3 €500):   MAE €${Math.round(oldE.mae).toLocaleString("nl-BE")}  (n=${oldE.n})`);
console.log(`  NIEUW (cat2 €1100, cat3 €900): MAE €${Math.round(newE.mae).toLocaleString("nl-BE")}`);
console.log(`  → ${Math.round((1 - newE.mae / oldE.mae) * 100)}% minder fout op cat2/cat3\n`);

// full m²-subtotal: expert woon €/m² (cat1 perfect) + cat2/cat3 at basis, vs expert m²-subtotal
console.log("══ Volledige m²-subtotaal (expert woon €/m² + cat2 €1100 + cat3 €900) ══");
console.log("dossier      woon m²  woon€/m²  niet  terras   PlanBase     expert(m²)    Δ");
let maeOld = 0, maeNew = 0;
for (const d of apt) {
  const expSub = d.cats.cat1.val + d.cats.cat2.val + d.cats.cat3.val;
  const predNew = d.cats.cat1.opp * d.woonEur + d.cats.cat2.opp * 1100 + d.cats.cat3.opp * 900;
  const predOld = d.cats.cat1.opp * d.woonEur + d.cats.cat2.opp * 900 + d.cats.cat3.opp * 500;
  maeNew += Math.abs(predNew / expSub - 1); maeOld += Math.abs(predOld / expSub - 1);
  console.log(
    d.ref.padEnd(12) + String(Math.round(d.cats.cat1.opp)).padStart(7) + ("€" + d.woonEur).padStart(9) +
    String(Math.round(d.cats.cat2.opp)).padStart(6) + String(Math.round(d.cats.cat3.opp)).padStart(7) +
    eur(predNew).padStart(13) + eur(expSub).padStart(13) + pct(predNew / expSub - 1).padStart(8));
}
console.log(`\n  mediaan-|Δ| m²-subtotaal:  OUD ${pct(maeOld / apt.length)}   NIEUW ${pct(maeNew / apt.length)}  (n=${apt.length})`);
console.log("  (cat1 = expert €/m², dus dit isoleert de cat2/cat3-prijsfix)");

// woon €/m² distribution
const ws = apt.map((d) => d.woonEur).sort((a, b) => a - b);
const q = (p) => ws[Math.floor((ws.length - 1) * p)];
console.log(`\n══ woon €/m² verdeling (n=${ws.length}) ══`);
console.log(`  min €${ws[0]}  P25 €${q(.25)}  mediaan €${q(.5)}  P75 €${q(.75)}  max €${ws[ws.length-1]}`);
console.log(`  > cap €2900: ${ws.filter((w) => w > 2900).length} dossiers (luxe-staart, intentioneel geclipt)`);
