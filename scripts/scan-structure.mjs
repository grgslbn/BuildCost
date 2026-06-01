import { execSync } from "node:child_process";
const FILE = process.argv[2];
let t = "";
try { t = execSync(`pdftotext -layout "${FILE}" -`, { encoding: "utf8", maxBuffer: 5e8 }); } catch (e) { console.error("pdftotext fail", e.message); process.exit(1); }
const pages = t.split("\f");
const planKw = /grondplan|niveau|verdieping|gelijkvloers|appartement|leefruimte|slaapkamer|keuken|badkamer|inkomhal|traphal/gi;
const labelRe = /\d{1,3}(?:[.,]\d{1,2})?\s*m[²2]/gi;
const tableKw = /Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl|Totaal kapitaal/i;
const sectionKw = /gevel|snede|doorsnede|inplanting|situatie|detail|elektr|riolering|stabiliteit|funder/i;
let planPages = [], tablePages = [], labelHeavy = [];
const counts = { plan: 0, table: 0, section: 0, other: 0, totLabels: 0 };
pages.forEach((p, i) => {
  const pk = (p.match(planKw) || []).length;
  const lb = (p.match(labelRe) || []).length;
  const isTable = tableKw.test(p);
  const isSection = sectionKw.test(p);
  counts.totLabels += lb;
  if (isTable) { tablePages.push(i); counts.table++; }
  else if (pk >= 3) { planPages.push({ i, pk, lb }); counts.plan++; if (lb >= 5) labelHeavy.push({ i, lb }); }
  else if (isSection) counts.section++;
  else counts.other++;
});
console.log(`pagina's: ${pages.length}`);
console.log(`counts:`, JSON.stringify(counts));
console.log(`tabel-pagina's (Berekening/meetstaat): ${tablePages.length}` + (tablePages.length ? ` → [${tablePages.slice(0, 12).join(",")}${tablePages.length > 12 ? ",…" : ""}]` : ""));
console.log(`plan-pagina's (grondplan-kw≥3): ${planPages.length}`);
console.log(`label-rijke plan-pagina's (≥5 m²-labels): ${labelHeavy.length} → [${labelHeavy.slice(0, 20).map(x => `p${x.i}(${x.lb})`).join(", ")}]`);
