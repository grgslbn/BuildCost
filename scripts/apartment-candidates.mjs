/**
 * apartment-candidates.mjs — apartment buildings with their expert €/m² tier
 * and a readable plan, so we can vision-extract the representative unit's
 * finish features and correlate with the rate.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] || "C:/Users/tieme/Mijn Drive/M²Value/field/ALL/SPLIT_V2";
const planMB = {};
for (const f of readdirSync(DIR)) { const m = f.match(/^(.+)_Plannen\.pdf$/i); if (m) planMB[m[1]] = statSync(join(DIR, f)).size / 1e6; }

const rows = readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean);
const byRef = {};
for (const r of rows) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m; const d = desc.toLowerCase();
  if (cat !== "cat1" || !/appartement/.test(d)) continue;
  if (/meerprijs|kelder|garage|berging|entree|tussenvloer|gemene|parking|technieken|zolder|inrichting/.test(d)) continue;
  const size = +opp, price = +e; if (size < 25 || size > 400 || price < 1200 || price > 4000) continue;
  (byRef[ref] ??= []).push(price);
}
const cands = Object.entries(byRef).map(([ref, prices]) => {
  const med = [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  return { ref, eur: med, n: prices.length, mb: planMB[ref] || 0 };
}).filter((c) => c.mb >= 2 && c.mb <= 12).sort((a, b) => a.eur - b.eur);

const tier = (e) => e < 2050 ? "LAAG" : e < 2400 ? "MIDDEN" : "HOOG";
console.log(`Appartementsgebouwen met leesbaar plan (2-12MB): ${cands.length}\n`);
for (const c of cands) console.log(`  ${tier(c.eur).padEnd(7)} €${c.eur}/m²  ${c.ref}  (${c.n} app-regels, plan ${c.mb.toFixed(1)}MB)`);
