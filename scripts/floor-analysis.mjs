/**
 * floor-analysis.mjs — does #building-layers (bouwlagen, from the Niveau column)
 * predict apartment €/m²? Re-parses berekeningen capturing niveau per line.
 */
import * as mupdf from "mupdf";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] || "C:/Users/tieme/Mijn Drive/M²Value/field/ALL/SPLIT_V2";
const num = (s) => parseFloat(String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

function classify(d) {
  d = d.toLowerCase();
  if (/terras|balkon|dakterras|groendak/.test(d)) return "cat3";
  if (/garage|kelder|berging|techniek|parking|magazijn|opslag|werkplaats|doorrit|carport|fietsen|stalling|\bzolder\b|nachtlevering/.test(d)) return "cat2";
  return "cat1";
}
function isAptLiving(d) {
  d = d.toLowerCase();
  if (!/appartement/.test(d)) return false;
  return !/meerprijs|kelder|garage|berging|entree|tussenvloer|gemene|parking|technieken|zolder|inrichting|magazijn|kantoor|handel/.test(d);
}

function linesFromPage(page) {
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
  const items = [];
  for (const b of json.blocks || []) for (const ln of b.lines || []) {
    const t = (ln.text != null) ? ln.text : (ln.spans || []).map(s => s.text ?? "").join("");
    if (t && t.trim()) items.push({ x: ln.bbox?.x ?? 0, y: ln.bbox?.y ?? 0, text: t.trim() });
  }
  const valueRows = items.filter(it => it.x > 460 && /€?\s*[\d.]+,\d{2}/.test(it.text) && num(it.text) > 500)
    .map(it => ({ y: it.y, waarde: num(it.text) })).sort((a, b) => a.y - b.y);
  const out = []; let prevY = 0;
  for (const vr of valueRows) {
    const opp = items.find(it => it.x >= 390 && it.x < 465 && Math.abs(it.y - vr.y) < 8 && /^[\d.]+,\d{2}$/.test(it.text));
    const niv = items.find(it => it.x >= 108 && it.x < 170 && Math.abs(it.y - vr.y) < 8 && /^-?\d+$/.test(it.text));
    const desc = items.filter(it => it.x < 115 && it.y > prevY + 3 && it.y <= vr.y + 6 && !/^-?\d/.test(it.text) && !/niveau|omschrijving/i.test(it.text)).map(it => it.text).join(" ").trim();
    prevY = vr.y;
    if (opp && num(opp.text) > 2 && desc) {
      const o = num(opp.text), e = Math.round(vr.waarde / o);
      if (e >= 50 && e <= 12000) out.push({ niveau: niv ? parseInt(niv.text, 10) : null, desc, opp: o, eurm2: e });
    }
  }
  return out;
}

const files = readdirSync(DIR).filter(f => /_Berekening\.pdf$/i.test(f));
const dossiers = [];
for (const f of files) {
  const ref = f.replace(/_Berekening\.pdf$/i, "");
  try {
    const doc = mupdf.Document.openDocument(readFileSync(join(DIR, f)), "application/pdf");
    const lines = []; const seen = new Set();
    for (let i = 0; i < doc.countPages(); i++) for (const r of linesFromPage(doc.loadPage(i))) {
      const k = `${r.desc}|${r.opp}|${r.eurm2}`; if (seen.has(k)) continue; seen.add(k); lines.push(r);
    }
    const niveaus = lines.map(l => l.niveau).filter(n => n != null);
    const above = niveaus.filter(n => n >= 0);
    const bouwlagen = above.length ? Math.max(...above) + 1 : null;
    const aptLines = lines.filter(l => isAptLiving(l.desc));
    if (aptLines.length && bouwlagen) {
      const prices = aptLines.map(l => l.eurm2).sort((a, b) => a - b);
      dossiers.push({ ref, bouwlagen, eur: prices[Math.floor(prices.length / 2)], nApt: aptLines.length });
    }
  } catch {}
}
console.log(`Appartementsgebouwen met bouwlaag-data: ${dossiers.length}\n`);

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function pearson(xs, ys) { const n = xs.length, mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxy / Math.sqrt(sxx * syy); }

console.log(`Correlatie bouwlagen ↔ €/m²:  r = ${pearson(dossiers.map(d => d.bouwlagen), dossiers.map(d => d.eur)).toFixed(3)}\n`);
console.log("=== €/m² per aantal bouwlagen (± SE) ===");
for (let bl = 1; bl <= 8; bl++) {
  const a = dossiers.filter(d => d.bouwlagen === bl).map(d => d.eur);
  if (a.length < 2) { if (a.length) console.log(`  ${bl} lagen: n=${a.length} €${Math.round(a[0])}`); continue; }
  const se = sd(a) / Math.sqrt(a.length);
  console.log(`  ${bl} lagen: n=${String(a.length).padStart(3)}  €${Math.round(mean(a))} ± ${Math.round(se)}`);
}
const aPlus = dossiers.filter(d => d.bouwlagen >= 9).map(d => d.eur);
if (aPlus.length) console.log(`  9+ lagen: n=${aPlus.length} €${Math.round(mean(aPlus))}`);

// ── avg apartment unit size per ref (from harvest) to control for confound ──
const sizeByRef = {};
{
  const tmp = {};
  for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
    const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),/); if (!m) continue;
    if (m[2] !== "cat1" || !/appartement/i.test(m[3])) continue;
    if (/meerprijs|kelder|garage|berging|gemene|technieken/i.test(m[3])) continue;
    (tmp[m[1]] ??= []).push(+m[4]);
  }
  for (const k in tmp) sizeByRef[k] = mean(tmp[k]);
}
for (const d of dossiers) d.avgSize = sizeByRef[d.ref] ?? null;

// ── CV: does a 4+ layer flag improve prediction? ──
const D = dossiers; const yAll = D.map(d => d.eur);
const meanMAE = () => { const m = mean(yAll); return mean(yAll.map(v => Math.abs(v - m))); };
function cvFlag(folds = 5) {
  let e = 0, c = 0;
  for (let f = 0; f < folds; f++) {
    const tr = D.filter((_, i) => i % folds !== f), te = D.filter((_, i) => i % folds === f);
    const mHi = mean(tr.filter(d => d.bouwlagen >= 4).map(d => d.eur)) || mean(tr.map(d => d.eur));
    const mLo = mean(tr.filter(d => d.bouwlagen < 4).map(d => d.eur)) || mean(tr.map(d => d.eur));
    for (const d of te) { e += Math.abs((d.bouwlagen >= 4 ? mHi : mLo) - d.eur); c++; }
  }
  return e / c;
}
console.log(`\n=== CV: helpt een "≥4 bouwlagen"-vlag? ===`);
console.log(`  constante                €${Math.round(meanMAE())}`);
console.log(`  twee groepen (<4 / ≥4)   €${Math.round(cvFlag())}`);

// ── confound check: is the 4-layer effect independent of unit size? ──
const withSize = D.filter(d => d.avgSize != null);
const hi = withSize.filter(d => d.bouwlagen >= 4), lo = withSize.filter(d => d.bouwlagen < 4);
console.log(`\n=== Confound-check (unit-grootte) ===`);
console.log(`  ≥4 lagen: gem unit ${Math.round(mean(hi.map(d=>d.avgSize)))} m², €${Math.round(mean(hi.map(d=>d.eur)))}  (n=${hi.length})`);
console.log(`  <4 lagen: gem unit ${Math.round(mean(lo.map(d=>d.avgSize)))} m², €${Math.round(mean(lo.map(d=>d.eur)))}  (n=${lo.length})`);
// within mid-size units only (90-200 m²), compare 4+ vs <4
const midHi = withSize.filter(d => d.avgSize >= 90 && d.avgSize <= 220 && d.bouwlagen >= 4).map(d=>d.eur);
const midLo = withSize.filter(d => d.avgSize >= 90 && d.avgSize <= 220 && d.bouwlagen < 4).map(d=>d.eur);
if (midHi.length >= 3 && midLo.length >= 3) {
  const seD = Math.sqrt((sd(midHi)/Math.sqrt(midHi.length))**2 + (sd(midLo)/Math.sqrt(midLo.length))**2);
  const diff = mean(midHi) - mean(midLo);
  console.log(`  Bij gelijke unit-grootte (90-220 m²):  ≥4 lagen €${Math.round(mean(midHi))} (n=${midHi.length}) vs <4 €${Math.round(mean(midLo))} (n=${midLo.length})  Δ=€${Math.round(diff)} ± ${Math.round(seD)} → ${Math.abs(diff)>2*seD?"nog steeds SIGNIFICANT (echte lift-factor)":"verdwijnt (was confound met grootte)"}`);
}
