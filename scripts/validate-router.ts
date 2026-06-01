/* Validate the deterministic area-table parser vs the vision ground truth. */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { parseAreaTableFromText, detectSqmSource } from "../src/lib/sqm/sqm-router";

const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const files = readdirSync(DIR).filter((f) => /Verzamel.*\.pdf$/i.test(f) && !/kopie/i.test(f));

console.log("dossier        bron        parser-cat1  heated-GT   Δ");
let n = 0, within10 = 0, tableFound = 0;
const deltas: number[] = [];
for (const f of files) {
  const ref = (f.match(/^(\d{2}-\d{6})/) || [])[1] || f.slice(0, 12);
  if (!gt[ref]) continue;
  let text = "";
  try { text = execSync(`pdftotext -layout "${join(DIR, f)}" -`, { encoding: "utf8", maxBuffer: 9e7 }); } catch { continue; }
  const { source } = detectSqmSource(text);
  const tbl = parseAreaTableFromText(text);
  const heated = gt[ref].heated_m2;
  if (tbl.found) tableFound++;
  const cat1 = tbl.areas.cat1;
  const d = cat1 && heated ? cat1 / heated - 1 : null;
  if (d != null) { n++; deltas.push(Math.abs(d)); if (Math.abs(d) <= 0.10) within10++; }
  console.log(
    ref.padEnd(13) + source.padEnd(12) + String(Math.round(cat1)).padStart(8) + String(Math.round(heated)).padStart(12) +
    "   " + (d != null ? (d >= 0 ? "+" : "") + (d * 100).toFixed(0) + "%" : "?"),
  );
}
const med = deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
console.log(`\n══ AREA-TABLE PARSER (route A) ══`);
console.log(`tabel gedetecteerd: ${tableFound}/${files.length}  |  cat1 vs heated-GT: mediaan-|Δ| ${med != null ? (med * 100).toFixed(0) : "-"}%  binnen 10%: ${within10}/${n}`);
console.log(`(de GT zelf komt uit dezelfde tabel via vision; match bewijst dat de tekst-parser ze deterministisch reproduceert)`);
