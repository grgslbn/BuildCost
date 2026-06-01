/**
 * bench-extract.mjs — extract the expert berekening (area + value rows, total, ABEX)
 * from every VerzamelPDF in the testing folder. Builds the ground-truth benchmark.
 * Output: scripts/bench-experts.json + a console summary (woon €/m², category areas).
 */
import { readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const DIR = "C:/Users/tieme/Desktop/testing 30_5";
const files = readdirSync(DIR).filter((f) => /VerzamelPDF.*\.pdf$/i.test(f) && !/- kopie/i.test(f));

const num = (s) => parseFloat(String(s).replace(/\./g, "").replace(",", "."));
// classify a description into cat1 (woon) / cat2 (niet) / cat3 (terras) / other
function classify(d) {
  d = d.toLowerCase();
  if (/terras|balkon|dakterras|dakterrassen|groendak|gras/.test(d)) return "cat3";
  if (/kelder|garage|berging|techniek|parking|staanplaats|inrit|fietsberg|afvalberg|liften?|lift\b|gemeenschapp|circulati|technische/.test(d)) return "cat2";
  if (/appartement|woning|woon|winkel|handels|kantoor|burel|bureel|studio|leefr|duplex|gelijkvloers|nivo|niveau|verdiep/.test(d)) return "cat1";
  return "other";
}

const out = [];
for (const f of files) {
  let t = ""; try { t = execSync(`pdftotext -layout "${join(DIR, f)}" -`, { encoding: "utf8", maxBuffer: 5e7 }); } catch { continue; }
  const lines = t.split("\n");
  const ref = f.match(/^(\d{2}-\d+?)\d{5}Verzamel/)?.[1] || f.slice(0, 12);

  // total
  let total = 0;
  const tm = t.match(/Totaal kapitaal in nieuwbouwwaarde\s*:?\s*([\d.]+,\d{2})/i)
    || t.match(/NIEUWBOUWWAARDE\s+INCLUSIEF BTW\s+([\d.]+,?\d{0,2})/i)
    || t.match(/Berekende nieuwbouwwaarde[^:]*:\s*([\d.]+,\d{2})/i);
  if (tm) total = num(tm[1]);
  const am = t.match(/ABEX[:\s]+(\d{3,4})/i); const abex = am ? +am[1] : null;

  // Restrict to the berekening table window: the ~60 lines ending at the total line.
  let endIdx = lines.findIndex((l) => /Totaal kapitaal in nieuwbouwwaarde|NIEUWBOUWWAARDE\s+INCLUSIEF/i.test(l));
  if (endIdx < 0) endIdx = lines.length;
  const startIdx = Math.max(0, endIdx - 70);
  const tableLines = lines.slice(startIdx, endIdx);

  const cats = { cat1: { opp: 0, val: 0 }, cat2: { opp: 0, val: 0 }, cat3: { opp: 0, val: 0 }, other: { opp: 0, val: 0 } };
  const rows = [];
  for (const ln of tableLines) {
    const areaM = ln.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m(?=[\s²2�])/);
    if (!areaM) continue;
    // value = the large number AFTER the area marker (the waarde column)
    const after = ln.slice(ln.indexOf(areaM[0]) + areaM[0].length);
    const vals = [...after.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{4,}(?:,\d{2})?)/g)].map((x) => num(x[1])).filter((v) => v >= 1000);
    if (!vals.length) continue;
    const opp = num(areaM[1]); if (opp < 2 || opp > 6000) continue;
    const val = vals[0]; // first big number after the area = waarde
    if (val < 1000 || val > 20_000_000) continue;
    const desc = ln.replace(/\s{2,}/g, " ").trim().slice(0, 55);
    const cat = classify(desc);
    cats[cat].opp += opp; cats[cat].val += val;
    rows.push({ desc, opp, val, eur: Math.round(val / opp), cat });
  }
  const woonEur = cats.cat1.opp ? Math.round(cats.cat1.val / cats.cat1.opp) : null;
  out.push({ ref, file: f, total, abex, cats, woonEur, rows });
}

writeFileSync("scripts/bench-experts.json", JSON.stringify(out, null, 1));
console.log("Dossier".padEnd(12) + "Totaal".padStart(14) + "ABEX".padStart(6) + "  woon m²".padStart(10) + " woon€/m²".padStart(10) + "  niet m²".padStart(9) + "  terras m²".padStart(10));
console.log("─".repeat(74));
for (const d of out) {
  console.log(
    d.ref.padEnd(12) +
    ("€" + (d.total || 0).toLocaleString("nl-BE")).padStart(14) +
    String(d.abex ?? "?").padStart(6) +
    String(Math.round(d.cats.cat1.opp)).padStart(10) +
    ("€" + (d.woonEur ?? "?")).padStart(10) +
    String(Math.round(d.cats.cat2.opp)).padStart(9) +
    String(Math.round(d.cats.cat3.opp)).padStart(10)
  );
}
console.log("\n→ scripts/bench-experts.json geschreven (" + out.length + " dossiers)");
