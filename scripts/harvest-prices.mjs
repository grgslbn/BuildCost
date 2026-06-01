/**
 * harvest-prices.mjs — extract expert €/m² per zone from all berekening PDFs.
 *
 * The CED berekening PDFs are generated (text layer). We use mupdf to read text
 * with coordinates, reconstruct the table rows (Opp ≈ x430, Waarde ≈ x480),
 * associate the multi-line description (x≈49), and compute €/m² per line.
 *
 * Output: per-category distribution + apartment-specific stats + CSV.
 *
 * Usage: node scripts/harvest-prices.mjs "C:/.../SPLIT_V2"
 */
import * as mupdf from "mupdf";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] || "C:/Users/tieme/Mijn Drive/M²Value/field/ALL/SPLIT_V2";
const num = (s) => parseFloat(String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

function classify(desc) {
  const d = desc.toLowerCase();
  if (/terras|balkon|dakterras|groendak|terrass/.test(d)) return "cat3";
  if (/ingericht.*zolder|bewoonbare zolder/.test(d)) return "cat1";
  if (/garage|kelder|berging|techniek|parking|magazijn|opslag|werkplaats|doorrit|carport|fietsen|stalling|\bzolder\b|nachtlevering/.test(d)) return "cat2";
  if (/appartement|woning|leefruimte|slaapkamer|living|woon|hotelkamer|studio|duplex|kantoor|vergaderruimte|restaurant|handel|winkel|praktijk|keuken|badkamer|ontbijt|lounge|gemene delen|polyvalent|eetkamer|bureau|zaal/.test(d)) return "cat1";
  return "other";
}

function rowsFromPage(page) {
  const st = page.toStructuredText("preserve-whitespace");
  const json = JSON.parse(st.asJSON());
  const items = [];
  for (const b of json.blocks || []) {
    for (const line of b.lines || []) {
      const text = (line.text != null) ? line.text
        : (line.spans || []).map((s) => s.text ?? (s.chars || []).map((c) => c.c).join("")).join("");
      const bb = line.bbox || {};
      if (text && text.trim()) items.push({ x: bb.x ?? 0, y: bb.y ?? 0, text: text.trim() });
    }
  }
  // value rows = items with a € amount near the Waarde column (x>465)
  const valueRows = items
    .filter((it) => it.x > 460 && /€?\s*[\d.]+,\d{2}/.test(it.text) && num(it.text) > 500)
    .map((it) => ({ y: it.y, waarde: num(it.text) }))
    .sort((a, b) => a.y - b.y);

  const rows = [];
  let prevY = 0;
  for (const vr of valueRows) {
    // opp: number in the Opp column (x 395..462) on same row (y within 8)
    const oppItem = items.find((it) => it.x >= 390 && it.x < 465 && Math.abs(it.y - vr.y) < 8 && /^[\d.]+,\d{2}$/.test(it.text));
    const opp = oppItem ? num(oppItem.text) : null;
    // description: all left-column text (x<115) with y in (prevY, vr.y+6]
    const desc = items
      .filter((it) => it.x < 115 && it.y > prevY + 3 && it.y <= vr.y + 6 && !/^\d/.test(it.text) && !/niveau|omschrijving/i.test(it.text))
      .map((it) => it.text).join(" ").trim();
    prevY = vr.y;
    if (opp && opp > 2 && opp < 20000 && desc) {
      const eurm2 = Math.round(vr.waarde / opp);
      if (eurm2 >= 50 && eurm2 <= 12000) rows.push({ desc, opp, waarde: vr.waarde, eurm2, cat: classify(desc) });
    }
  }
  return rows;
}

const files = readdirSync(DIR).filter((f) => /_Berekening\.pdf$/i.test(f));
console.log(`Berekening files: ${files.length}`);

const all = [];
let ok = 0, fail = 0;
for (const f of files) {
  const ref = f.replace(/_Berekening\.pdf$/i, "");
  try {
    const doc = mupdf.Document.openDocument(readFileSync(join(DIR, f)), "application/pdf");
    const seen = new Set();
    for (let i = 0; i < doc.countPages(); i++) {
      for (const r of rowsFromPage(doc.loadPage(i))) {
        const key = `${r.desc}|${r.opp}|${r.waarde}`;
        if (seen.has(key)) continue; // dedupe repeated pages
        seen.add(key);
        all.push({ ref, ...r });
      }
    }
    ok++;
  } catch (e) { fail++; }
}
console.log(`Parsed ok: ${ok}, failed: ${fail}, total line-items: ${all.length}`);

function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
  return { n: s.length, min: s[0], p10: q(0.10), p25: q(0.25), median: q(0.50), p75: q(0.75), p90: q(0.90), max: s[s.length - 1], mean };
}

const apt = all.filter((r) => /appartement/i.test(r.desc)).map((r) => r.eurm2);
const cat1 = all.filter((r) => r.cat === "cat1").map((r) => r.eurm2);
const cat2 = all.filter((r) => r.cat === "cat2").map((r) => r.eurm2);
const cat3 = all.filter((r) => r.cat === "cat3").map((r) => r.eurm2);

console.log("\n=== €/m² distributie ===");
console.log("APPARTEMENT (desc bevat 'appartement'):", JSON.stringify(stats(apt)));
console.log("CAT1 (alle woon/livable):            ", JSON.stringify(stats(cat1)));
console.log("CAT2 (garage/kelder/berging/...):    ", JSON.stringify(stats(cat2)));
console.log("CAT3 (terras/balkon/groendak):       ", JSON.stringify(stats(cat3)));

// histogram for apartments (€250 buckets)
if (apt.length) {
  console.log("\n=== APPARTEMENT histogram (€250 buckets) ===");
  const buckets = {};
  for (const v of apt) { const b = Math.floor(v / 250) * 250; buckets[b] = (buckets[b] || 0) + 1; }
  for (const b of Object.keys(buckets).map(Number).sort((a, b) => a - b)) {
    console.log(`  €${b}-${b + 249}: ${"#".repeat(buckets[b])} (${buckets[b]})`);
  }
}

// CSV
const csv = ["ref,cat,desc,opp,waarde,eur_per_m2"];
for (const r of all) csv.push(`${r.ref},${r.cat},"${r.desc.replace(/"/g, "'")}",${r.opp},${r.waarde},${r.eurm2}`);
writeFileSync(join("scripts", "harvest-prices.csv"), csv.join("\n"));
console.log(`\nCSV: scripts/harvest-prices.csv (${all.length} rows)`);
