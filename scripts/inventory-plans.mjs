/**
 * inventory-plans.mjs — Fase 0 van de SQM ±10% goal.
 * Scant VerzamelPDFs (text-layer analyse, geen API-calls) en classificeert per dossier:
 *  - tablePages: berekening/oppervlaktestaat (Tier 1 signaal, ook = GT-bron)
 *  - vectorPlanPages: pagina's met maatketen-dichtheid (dims-only kandidaten)
 *  - imagePages: pagina's zonder tekstlaag (gescand)
 *  - m2Labels: gedrukte m²-labels buiten de tabelpagina's (Tier 2 signaal)
 * Output: scripts/inventory.jsonl (incrementeel) + eindsamenvatting.
 *
 * Usage: node scripts/inventory-plans.mjs [maxFiles] [--dir=PATH]
 */
import { readFileSync, readdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = (process.argv.find((a) => a.startsWith("--dir=")) || "").slice(6) ||
  "C:/Users/tieme/Mijn Drive/M²Value/field/ALL";
const MAX = parseInt(process.argv[2] || "999999", 10);
const OUT = join(ROOT, "scripts", "inventory.jsonl");

const files = readdirSync(DIR).filter((f) => /\.pdf$/i.test(f));
const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split(/\r?\n/)) {
    try { done.add(JSON.parse(line).file); } catch { /* skip */ }
  }
}

const TABLE_RE = /Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl|Surf\/contenu/i;
// dimension tokens: 4,50  12.35  450 (cm) — meters with 2 decimals are the strongest signal
const DIM_RE = /\b\d{1,2}[.,]\d{2}\b/g;
const M2_RE = /\d[\d.,]*\s*(m²|m2\b)/gi;
const PROSE_RE = /\b(de|het|een|van|voor|wordt|zijn|avec|dans|pour|les|des)\b/gi;

let n = 0;
for (const f of files) {
  if (n >= MAX) break;
  if (done.has(f)) continue;
  n++;
  const rec = { file: f, ref: (f.match(/^(\d{2}-\d{6})/) || [])[1] || null };
  try {
    const txt = execFileSync("pdftotext", ["-layout", join(DIR, f), "-"], { encoding: "utf8", maxBuffer: 2e8, timeout: 120000 });
    const pages = txt.split("\f");
    rec.pages = pages.length;
    let table = [], vector = [], image = [], m2 = 0, m2OnPlan = 0;
    pages.forEach((p, i) => {
      const chars = p.replace(/\s/g, "").length;
      const dims = (p.match(DIM_RE) || []).length;
      const m2c = (p.match(M2_RE) || []).length;
      const prose = (p.match(PROSE_RE) || []).length;
      m2 += m2c;
      if (TABLE_RE.test(p)) { table.push(i); return; }
      if (chars < 60) { image.push(i); return; }
      // plan heuristic: many dimension tokens, little prose
      if (dims >= 12 && prose < dims) { vector.push(i); m2OnPlan += m2c; }
    });
    rec.tablePages = table.length; rec.vectorPlanPages = vector.length;
    rec.imagePages = image.length; rec.m2Total = m2; rec.m2OnPlanPages = m2OnPlan;
    rec.vectorIdx = vector.slice(0, 12); rec.tableIdx = table.slice(0, 8);
    // dossier-level classification of the PLAN signal (ignoring the table, which is GT)
    rec.planClass =
      rec.vectorPlanPages === 0 && rec.imagePages >= 3 ? "scanned_or_photos"
      : rec.vectorPlanPages > 0 && rec.m2OnPlanPages >= 4 ? "labeled_vector"
      : rec.vectorPlanPages > 0 ? "dims_only_vector"
      : "no_plan_signal";
    rec.hasTable = rec.tablePages > 0;
  } catch (e) {
    rec.error = String(e.message || e).slice(0, 120);
  }
  appendFileSync(OUT, JSON.stringify(rec) + "\n");
  if (n % 25 === 0) console.log(`${n} verwerkt...`);
}

// summary over the FULL jsonl
const all = readFileSync(OUT, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);
const by = {};
for (const r of all) by[r.planClass] = (by[r.planClass] || 0) + 1;
const withTable = all.filter((r) => r.hasTable).length;
console.log(`\n=== INVENTARIS (${all.length} dossiers) ===`);
console.log("met berekening-tabel (tekstueel gedetecteerd):", withTable);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
const t3 = all.filter((r) => (r.planClass === "dims_only_vector" || r.planClass === "scanned_or_photos") && r.hasTable);
console.log(`Tier-3 kandidaten MET GT-tabel (dims/scanned + berekening aanwezig): ${t3.length}`);
writeFileSync(join(ROOT, "scripts", "inventory-summary.json"), JSON.stringify({ total: all.length, withTable, by, tier3WithGT: t3.map((r) => r.ref) }, null, 2));
