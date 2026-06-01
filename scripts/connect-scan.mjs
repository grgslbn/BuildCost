/**
 * connect-scan.mjs — scan Connect Value calc PDFs for the three section m²
 * (handels/horeca, woonvertrekken, niet-ingerichte) to find pure-residential files.
 */
import { readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const DIR = "C:/Users/tieme/Mijn Drive/M²Value/connect value/calc";
const files = readdirSync(DIR).filter((f) => /^calc\d+\.pdf$/i.test(f));
console.log(`Files: ${files.length}`);

function textOf(f) {
  try { return execSync(`pdftotext -layout "${join(DIR, f)}" -`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }); }
  catch { return ""; }
}
const brutoIn = (seg) => { const m = seg.match(/Bruto m\S*\s+(\d[\d.]*)/); return m ? parseInt(m[1].replace(/\./g, ""), 10) : 0; };

let woonFiles = 0, pure = 0;
const rows = [];
for (const f of files) {
  const t = textOf(f);
  if (!t) continue;
  // split by section headers
  const iH = t.search(/Ingerichte handels/i);
  const iW = t.search(/Woonvertrekken/i);
  const iN = t.search(/Niet ingerichte ruimtes/i);
  const iL = t.search(/Liften/i);
  const handels = iH >= 0 ? brutoIn(t.slice(iH, iW > iH ? iW : undefined)) : 0;
  const woon = iW >= 0 ? brutoIn(t.slice(iW, iN > iW ? iN : undefined)) : 0;
  const niet = iN >= 0 ? brutoIn(t.slice(iN, iL > iN ? iL : undefined)) : 0;
  if (woon > 0) {
    woonFiles++;
    const isPure = handels === 0 && niet === 0;
    if (isPure) pure++;
    rows.push({ f, handels, woon, niet, pure: isPure });
  }
}
console.log(`Met woonvertrekken > 0: ${woonFiles}  |  puur residentieel (handels=0, niet=0): ${pure}\n`);
console.log("Puur-residentiële files (woon m²):");
for (const r of rows.filter((r) => r.pure).sort((a, b) => a.woon - b.woon)) console.log(`  ${r.f}  woon=${r.woon} m²`);
console.log("\nGemengd (woon + iets anders) — eerste 15:");
for (const r of rows.filter((r) => !r.pure).slice(0, 15)) console.log(`  ${r.f}  handels=${r.handels} woon=${r.woon} niet=${r.niet}`);
