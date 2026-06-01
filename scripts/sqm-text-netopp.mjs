/**
 * sqm-text-netopp.mjs — DETERMINISTIC net-area extraction from PLAN TEXT (no vision).
 * Architect unit-area labels (BO/Opp/BVO + value) are real text in the PDF. Extract
 * them per floor-plan page, classify by prefix/context, sum the dwelling-unit areas.
 * This avoids vision over/under-counting entirely.
 * Compares net (and net×1.3) to the corrected heated-floor ground truth.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const bench = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"))
  .filter((d) => /appartement/i.test(d.building_type || "") && (gt[d.ref]?.heated_m2 || 0) > 120);

const num = (s) => parseFloat(s.replace(".", "").replace(",", "."));

function extractNet(file) {
  let t = ""; try { t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 }); } catch { return null; }
  const pages = t.split("\f");
  const roomKw = /slaapkamer|leefruimte|badkamer|keuken|berging|inkomhal|traphal/gi;
  // dwelling-unit area label patterns (BO/BVO/Opp + value); also "app ... NN,N m²"
  const unitPat = /\b(?:BVO|BO|Opp\.?)\s*:?\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*m/gi;
  const found = []; // {val, page}
  pages.forEach((p, pi) => {
    if ((p.match(roomKw) || []).length < 5) return; // floor-plan pages only
    let m;
    const re = new RegExp(unitPat.source, "gi");
    while ((m = re.exec(p))) {
      const v = num(m[1]);
      if (v >= 25 && v <= 350) found.push({ val: v, page: pi }); // dwelling-sized
    }
  });
  return found;
}

console.log("ref          #labels  netto-som  netto-uniek  heated-GT   net×1.3   Δ(uniek×1.3)");
const rows = [];
for (const d of bench) {
  const f = extractNet(d.file);
  if (!f) { console.log(d.ref.padEnd(13) + "  (pdftotext faalde)"); continue; }
  const sumAll = f.reduce((s, x) => s + x.val, 0);
  // unique values (same unit drawn on multiple sheets → dedupe by value+count heuristic)
  const counts = {}; f.forEach((x) => { const k = x.val.toFixed(1); counts[k] = (counts[k] || 0) + 1; });
  // keep each distinct value ONCE × (occurrences on distinct pages, capped) — approx unique units
  const uniqueVals = Object.keys(counts).map(Number);
  const sumUnique = uniqueVals.reduce((s, v) => s + v, 0);
  const heated = gt[d.ref].heated_m2;
  const pred = sumUnique * 1.3;
  const delta = sumUnique ? pred / heated - 1 : null;
  rows.push({ ref: d.ref, labels: f.length, sumAll: Math.round(sumAll), sumUnique: Math.round(sumUnique), heated, delta });
  console.log(d.ref.padEnd(13) + String(f.length).padStart(6) + String(Math.round(sumAll)).padStart(11) + String(Math.round(sumUnique)).padStart(12) + String(heated).padStart(11) + String(Math.round(pred)).padStart(10) + "    " + (delta != null ? (delta >= 0 ? "+" : "") + (delta * 100).toFixed(0) + "%" : "?"));
}
const ds = rows.filter((r) => r.delta != null).map((r) => Math.abs(r.delta)).sort((a, b) => a - b);
const within = (p) => ds.filter((x) => x <= p).length;
console.log(`\nn=${ds.length}  mediaan-|Δ| ${ds.length ? (ds[Math.floor(ds.length / 2)] * 100).toFixed(0) : "-"}%  binnen 10%: ${within(0.10)}/${ds.length}  binnen 15%: ${within(0.15)}/${ds.length}`);
console.log("(labels-kolom = aantal BO/Opp/BVO-labels gevonden in tekst; 0 = plan heeft geen tekst-labels)");
