/**
 * test-price-level.mjs — validate the cat1 (woon) PRICE LEVEL of the model against
 * TWO broad sources (no QQPs needed — tests the price band, not the QQP→F mapping):
 *
 *  Part 1: CED expert berekeningen (harvest-prices.csv, ~600 dossiers, incl btw)
 *  Part 2: Connect Value calc PDFs (~196 files, excl btw → ×1.21)
 *
 * For each dossier: the expert/Connect woon €/m². We back out the F the model
 * would NEED to reproduce that price (cat1 only), and check whether the model
 * band [F 0.70 → 1.50] = [€1600 → €2900 incl btw] brackets the real distribution.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const F_MIN = 0.70, F_MAX = 1.50, CAT1_MIN = 1600, CAT1_MAX = 2900;
const reqF = (eurIncl) => F_MIN + (eurIncl - CAT1_MIN) / (CAT1_MAX - CAT1_MIN) * (F_MAX - F_MIN);
const STANDARD = 2000, STANDARD_F = 0.96; // model standard (intercept target)

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
const stats = (arr) => ({ n: arr.length, p10: q(arr, .1), p25: q(arr, .25), med: q(arr, .5), p75: q(arr, .75), p90: q(arr, .9), mean: arr.reduce((a, b) => a + b, 0) / arr.length });
const band = (arr, lo, hi) => ({ below: arr.filter((x) => x < lo).length, inside: arr.filter((x) => x >= lo && x <= hi).length, above: arr.filter((x) => x > hi).length });
const pc = (n, tot) => `${n} (${Math.round(n / tot * 100)}%)`;

function reportSource(label, woonPerSqm, btwNote) {
  const s = stats(woonPerSqm);
  const b = band(woonPerSqm, CAT1_MIN, CAT1_MAX);
  const reqFs = woonPerSqm.map(reqF);
  const reqClamped = reqFs.map((f) => Math.max(F_MIN, Math.min(F_MAX, f)));
  const sF = stats(reqClamped);
  console.log(`\n${"═".repeat(78)}`);
  console.log(`${label}  (n=${s.n} dossiers, ${btwNote})`);
  console.log("═".repeat(78));
  console.log(`  woon €/m²:   p10 €${Math.round(s.p10)}  p25 €${Math.round(s.p25)}  MEDIAAN €${Math.round(s.med)}  p75 €${Math.round(s.p75)}  p90 €${Math.round(s.p90)}  (gem €${Math.round(s.mean)})`);
  console.log(`  Model band [€${CAT1_MIN}–€${CAT1_MAX}]:`);
  console.log(`     onder band (<€${CAT1_MIN}, model-vloer te hoog): ${pc(b.below, s.n)}`);
  console.log(`     binnen band:                                 ${pc(b.inside, s.n)}`);
  console.log(`     boven band (>€${CAT1_MAX}, model-cap te laag):  ${pc(b.above, s.n)}`);
  console.log(`  Benodigde F-verdeling (geclampt):  mediaan ${sF.med.toFixed(2)}  p25 ${sF.p25.toFixed(2)}  p75 ${sF.p75.toFixed(2)}`);
  console.log(`  Model-standaard: F=${STANDARD_F} → €${STANDARD}.  Δ model-standaard vs bron-mediaan: ${(STANDARD / s.med - 1 >= 0 ? "+" : "")}${Math.round((STANDARD / s.med - 1) * 100)}%`);
  return s;
}

// ── PART 1: CED expert berekeningen ──────────────────────────────────────────
const csv = readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean);
const cedByRef = {};
for (const r of csv) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m;
  const d = desc.toLowerCase(), eur = +e, sz = +opp;
  if (cat !== "cat1") continue;
  if (!/appartement|woning|leefruimte|woonvertrek|\bwoon/.test(d)) continue;
  if (/meerprijs|kelder|garage|berging|gemene|technieken|entree|tussenvloer|terras|balkon/.test(d)) continue;
  if (!(sz >= 20 && sz <= 600 && eur >= 1200 && eur <= 4000)) continue;
  (cedByRef[ref] ??= []).push(eur);
}
const cedWoon = Object.values(cedByRef).map((vals) => q(vals, .5)); // median per dossier
reportSource("PART 1 — CED EXPERT berekeningen", cedWoon, "incl 21% btw");

// ── PART 2: Connect Value calc PDFs ──────────────────────────────────────────
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/connect value/calc";
const files = readdirSync(DIR).filter((f) => /^calc\d+\.pdf$/i.test(f));
const numNL = (s) => parseFloat(s.replace(/\./g, "").replace(",", "."));
const brutoIn = (seg) => { const m = seg.match(/Bruto m\S*\s+(\d[\d.]*)/); return m ? parseInt(m[1].replace(/\./g, ""), 10) : 0; };

const connWoon = [];
let scanned = 0, woonFiles = 0, residential = 0;
const NIET_RATE = 850; // Connect berging/garage excl btw (from Excel source)
for (const f of files) {
  let t = ""; try { t = execSync(`pdftotext -layout "${join(DIR, f)}" -`, { encoding: "utf8", maxBuffer: 1e7 }); } catch { continue; }
  scanned++;
  const iH = t.search(/Ingerichte handels/i), iW = t.search(/Woonvertrekken/i), iN = t.search(/Niet ingerichte ruimtes/i), iL = t.search(/Liften/i);
  if (iW < 0) continue;
  const handels = iH >= 0 ? brutoIn(t.slice(iH, iW > iH ? iW : undefined)) : 0;
  const woon = brutoIn(t.slice(iW, iN > iW ? iN : undefined));
  const niet = iN >= 0 ? brutoIn(t.slice(iN, iL > iN ? iL : undefined)) : 0;
  if (woon < 20) continue;
  woonFiles++;
  const after = t.slice(t.search(/Overige onroerende inrichting/i));
  const amt = after.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
  const total = amt ? numNL(amt[1]) : 0;
  const abexM = t.match(/ABEX-index\s+(\d+)/); const abex = abexM ? +abexM[1] : 1050;
  if (!total) continue;
  // RESIDENTIAL (no commercial GF): back out woon by subtracting garage at Connect rate
  if (handels === 0) {
    residential++;
    const woonValExcl = total - niet * NIET_RATE; // remove garage contribution
    if (woonValExcl <= 0) continue;
    const woonExcl = (woonValExcl / woon) * (1056 / abex); // €/m² normalized to ABEX 1056
    if (woonExcl >= 800 && woonExcl <= 3500) connWoon.push(woonExcl * 1.21); // → incl btw
  }
}
console.log(`\n(Connect: ${scanned} PDF's, ${woonFiles} met woon m², ${residential} residentieel (handels=0))`);
if (connWoon.length >= 3) {
  reportSource("PART 2 — CONNECT VALUE (residentieel, garage afgetrokken @€850)", connWoon, "excl→incl ×1.21, ABEX→1056");
} else {
  console.log("Te weinig bruikbare Connect-residentiële files. Connect woon-formule: basis €1402 → vol €1973 excl = €1697 → €2387 incl.");
}

console.log(`\n${"═".repeat(78)}`);
console.log("INTERPRETATIE");
console.log("═".repeat(78));
console.log("• 'onder band' = dossiers goedkoper dan model-vloer €1600 → model kan niet laag genoeg.");
console.log("• 'boven band' = dossiers duurder dan model-cap €2900 → model kan niet hoog genoeg.");
console.log("• Ideaal: mediaan benodigde F ≈ model-standaard (0.96), weinig dossiers buiten de band.");
