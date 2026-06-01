/**
 * bench-harvest.mjs — LARGE-SCALE benchmark over all harvested CED berekeningen
 * (harvest-prices.csv, 498 dossiers). Validates the cat1 band + cat2/cat3 basis
 * at scale, with NO API calls. Aggregates per dossier (weighted €/m² per category).
 */
import { readFileSync } from "node:fs";

const lines = readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean);
const byRef = {};
for (const r of lines) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, waarde, eur] = m;
  const o = +opp, w = +waarde, e = +eur;
  if (!(o > 0)) continue;
  (byRef[ref] ??= { cat1: { o: 0, w: 0 }, cat2: { o: 0, w: 0 }, cat3: { o: 0, w: 0 }, descs: [] });
  const d = desc.toLowerCase();
  // robust per-line classification (override the stored cat for woon detection)
  let c = "other";
  if (/terras|balkon|dakterras|groendak/.test(d)) c = "cat3";
  else if (/appartement|woning|leefr|woon|slaapk|studio|duplex|burel|kantoor|winkel|handels|verdiep|gelijkvloer/.test(d) && !/kelder|garage|berging|parking|techn/.test(d)) c = "cat1";
  else if (/kelder|garage|berging|parking|staanplaats|techn|opslag|fietsen|inrit/.test(d)) c = "cat2";
  if (c === "other") continue;
  byRef[ref][c].o += o; byRef[ref][c].w += w;
}

const dossiers = Object.entries(byRef).map(([ref, c]) => ({
  ref,
  woon: c.cat1.o > 10 ? c.cat1.w / c.cat1.o : null,
  niet: c.cat2.o > 5 ? c.cat2.w / c.cat2.o : null,
  terras: c.cat3.o > 2 ? c.cat3.w / c.cat3.o : null,
}));

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
const stats = (arr) => { const a = arr.filter((x) => x != null && x > 100 && x < 6000); return { n: a.length, p10: q(a, .1), p25: q(a, .25), med: q(a, .5), p75: q(a, .75), p90: q(a, .9), mean: Math.round(a.reduce((s, x) => s + x, 0) / a.length) }; };

const woon = stats(dossiers.map((d) => d.woon));
const niet = stats(dossiers.map((d) => d.niet));
const terras = stats(dossiers.map((d) => d.terras));

console.log(`══ GROOTSCHALIGE BENCHMARK — ${Object.keys(byRef).length} dossiers (harvest-prices.csv, incl btw) ══\n`);
const row = (lab, s, basis, mn, mx) => console.log(
  `${lab.padEnd(18)} n=${String(s.n).padStart(3)}  p10 €${s.p10}  p25 €${s.p25}  MED €${s.med}  p75 €${s.p75}  p90 €${s.p90}  | model basis €${basis} [${mn}-${mx}]`);
row("CAT1 woon", woon, 2150, 1600, 2900);
row("CAT2 niet", niet, 1100, 900, 1300);
row("CAT3 terras", terras, 900, 500, 900);

// band coverage for cat1
const w = dossiers.map((d) => d.woon).filter((x) => x != null && x > 100 && x < 6000);
const inBand = w.filter((x) => x >= 1600 && x <= 2900).length;
const below = w.filter((x) => x < 1600).length, above = w.filter((x) => x > 2900).length;
console.log(`\nCAT1-band [€1600–€2900] dekking: ${inBand}/${w.length} (${Math.round(inBand/w.length*100)}%)  | onder ${below} (${Math.round(below/w.length*100)}%)  boven ${above} (${Math.round(above/w.length*100)}%)`);
console.log(`Model-mediaan-doel: basis €2150 (F 1.04). Werkelijke mediaan: €${woon.med}.  Afwijking: ${Math.round((2150/woon.med-1)*100)}%`);

// cat2/cat3 basis validation: MAE of basis vs per-dossier expert €/m²
const maeAt = (arr, basis) => { const a = arr.filter((x) => x != null && x > 100 && x < 6000); return Math.round(a.reduce((s, x) => s + Math.abs(x - basis), 0) / a.length); };
console.log(`\nCAT2 basis-keuze (MAE per dossier): €900→${maeAt(dossiers.map(d=>d.niet),900)}  €1100→${maeAt(dossiers.map(d=>d.niet),1100)}  €1200→${maeAt(dossiers.map(d=>d.niet),1200)}`);
console.log(`CAT3 basis-keuze (MAE per dossier): €500→${maeAt(dossiers.map(d=>d.terras),500)}  €700→${maeAt(dossiers.map(d=>d.terras),700)}  €900→${maeAt(dossiers.map(d=>d.terras),900)}`);
