/**
 * connect-vs-ced-context.mjs — is the CED↔Connect woon gap methodology or
 * building context? Compares CED woon €/m² in MIXED buildings (wonen-boven-handel,
 * like Connect's files) vs PURE residential buildings, both vs Connect.
 */
import { readFileSync } from "node:fs";

const lines = readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean);
const byRef = {};
for (const r of lines) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m;
  (byRef[ref] ??= []).push({ cat, desc: desc.toLowerCase(), size: +opp, eur: +e });
}

const isCommercial = (d) => /restaurant|brasserie|caf|horeca|handel|winkel|kantoor|showroom|magazijn|atelier|werkplaats|praktijk|loods|slagerij|apotheek|bakkerij|frituur/.test(d);
const isWoonLine = (l) => l.cat === "cat1" && /appartement|woning|leefruimte|slaapkamer|\bwoon/.test(l.desc) && !/meerprijs|kelder|garage|berging|gemene|technieken|entree|tussenvloer/.test(l.desc) && l.size >= 25 && l.size <= 400 && l.eur >= 1400 && l.eur <= 3800;

const mixedWoon = [], pureWoon = [];
for (const [ref, ls] of Object.entries(byRef)) {
  const hasComm = ls.some((l) => isCommercial(l.desc));
  const woonLines = ls.filter(isWoonLine);
  if (!woonLines.length) continue;
  const med = [...woonLines.map((l) => l.eur)].sort((a, b) => a - b)[Math.floor(woonLines.length / 2)];
  if (hasComm) mixedWoon.push(med); else pureWoon.push(med);
}
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.reduce((p, q) => p + q, 0) / s.length; return { n: s.length, mean: Math.round(m), med: Math.round(s[Math.floor(s.length / 2)]) }; };

const mx = stats(mixedWoon), pr = stats(pureWoon);
const connectInc = 1403 * 1.21;
console.log("CED woon €/m² (incl btw):");
console.log(`  GEMENGD (wonen + commercieel, n=${mx.n}):  mediaan €${mx.med}  (gem €${mx.mean})`);
console.log(`  PUUR residentieel (n=${pr.n}):            mediaan €${pr.med}  (gem €${pr.mean})`);
console.log(`\nConnect woon (incl btw): €${Math.round(connectInc)}\n`);
console.log("── Vergelijking like-for-like ──");
console.log(`  CED gemengd €${mx.med}  vs  Connect €${Math.round(connectInc)}  → Δ ${Math.round((mx.med/connectInc-1)*100)}%`);
console.log(`  CED puur    €${pr.med}  vs  Connect €${Math.round(connectInc)}  → Δ ${Math.round((pr.med/connectInc-1)*100)}%`);
console.log(`\n  CED gemengd vs CED puur:  €${mx.med} vs €${pr.med}  → ${Math.round((pr.med/mx.med-1)*100)}% verschil door gebouwcontext`);
console.log(mx.med < pr.med
  ? `\n  → Wonen-boven-commercieel is bij CED ${Math.round((1-mx.med/pr.med)*100)}% goedkoper dan aparte woningen.\n    Een deel van de CED↔Connect-kloof is dus GEBOUWCONTEXT, niet puur methodologie.`
  : `\n  → Gebouwcontext verklaart het niet; het verschil is methodologisch.`);
