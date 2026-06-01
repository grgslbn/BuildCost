/**
 * connect-vs-ced.mjs — CED (INCL 21% btw) vs Connect Value, on the SAME basis.
 * Connect rates were excl btw → convert to incl (×1.21) to match CED.
 */
import { readFileSync } from "node:fs";

const lines = readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean);
const cat = { cat1: [], cat2: [], cat3: [] };
const apt = [];
for (const r of lines) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, , c, desc, opp, , e] = m; const eur = +e, sz = +opp;
  if (cat[c]) cat[c].push(eur);
  const d = desc.toLowerCase();
  if (c === "cat1" && /appartement/.test(d) && !/meerprijs|kelder|garage|gemene|technieken/.test(d) && sz >= 25 && sz <= 400 && eur >= 1400 && eur <= 3800) apt.push(eur);
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };

// CED = incl btw (as harvested). Connect excl → incl ×1.21.
const BTW = 1.21;
const cedWoon = med(apt), cedNiet = med(cat.cat2), cedCat3 = med(cat.cat3);
const conWoonEx = 1403, conNietEx = 935, conHandelsEx = 1328;
const conWoon = Math.round(conWoonEx * BTW), conNiet = Math.round(conNietEx * BTW), conHandels = Math.round(conHandelsEx * BTW);

console.log("════════ CED (incl btw)  vs  CONNECT VALUE (excl → incl btw) ════════\n");
console.log("Categorie            CED incl     Connect incl   Δ (CED − Connect)");
console.log(`Bewoonbaar (woon)    €${cedWoon}       €${conWoon}        +€${cedWoon - conWoon}  (CED +${Math.round((cedWoon/conWoon-1)*100)}%)`);
console.log(`Niet-bewoonbaar      €${cedNiet}        €${conNiet}        ${cedNiet - conNiet}  (CED ${Math.round((cedNiet/conNiet-1)*100)}%)`);
console.log(`Handel basis         ~€2.000-2.200 €${conHandels}        (CED hoger)`);

console.log(`\n── DE ECHTE STRUCTURELE VERSCHILLEN ──`);
console.log(`1) BTW: CED incl, Connect-bron excl → 21% niveauverschil (nu gecorrigeerd).`);
console.log(`2) Woon-prijs: CED €${cedWoon} vs Connect €${conWoon} incl → CED ~${Math.round((cedWoon/conWoon-1)*100)}% hoger (niet 50%, maar ~24% na btw-correctie).`);
console.log(`3) Niet-bewoonbaar: Connect €${conNiet} > CED €${cedNiet} → Connect ~${Math.round((conNiet/cedNiet-1)*100)}% HOGER (omgekeerd!).`);
console.log(`\n   → De kern: de WOON/NIET-VERHOUDING verschilt sterk:`);
console.log(`     CED:     woon/niet = ${(cedWoon/cedNiet).toFixed(2)}×   (afgewerkt wonen = ${(cedWoon/cedNiet).toFixed(1)}× een garage)`);
console.log(`     Connect: woon/niet = ${(conWoon/conNiet).toFixed(2)}×   (vlakker)`);
console.log(`   CED hanteert een veel STEILERE afwerkingspremie voor wonen; Connect is vlakker.`);

console.log(`\n── Impact op een woning (200 m² woon + 40 m² garage), incl btw ──`);
const cedT = 200 * cedWoon + 40 * cedNiet, conT = 200 * conWoon + 40 * conNiet;
console.log(`  CED:     €${cedT.toLocaleString("nl-BE")}`);
console.log(`  Connect: €${conT.toLocaleString("nl-BE")}`);
console.log(`  Δ €${(cedT - conT).toLocaleString("nl-BE")} (~${Math.round((cedT/conT-1)*100)}%)`);

console.log(`\n── Voor PlanBase ──`);
console.log(`  PlanBase F=1,0 → cat1 €2.088 (≈ CED €${cedWoon} incl). PlanBase volgt dus CED, niet Connect.`);
console.log(`  Wil je Connect matchen → cat1 ~€${conWoon} incl (≈ €${conWoonEx} excl).`);
