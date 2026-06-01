/**
 * sqm-netopp.mjs — SQM approach A: extract the NET unit areas (Opp/BO labels) per
 * dossier via vision (the most reliable signal the model can read), sum them, and
 * compare to the expert GROSS woon m² (bench-selectie.json) → derive the gross/net
 * factor. If a constant factor predicts gross within ~15%, this beats dimension-chain reading.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const AKEY = env.ANTHROPIC_API_KEY;
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const experts = JSON.parse(readFileSync("scripts/bench-selectie.json", "utf8"))
  .filter((d) => /appartement/i.test(d.building_type || "") && d.cats.cat1.opp > 50);

const SYS = `You read Belgian apartment floor plans and extract the NET floor area of each dwelling unit. Return ONLY JSON.`;
const INSTR = `These images are the floor plans of ONE apartment building (multiple floors). Each apartment/unit has a labeled net floor area (e.g. "Opp.: 74,76 m²", "BO 104,3 m²", "95,68 m²", "app 0.3A ... 104.3 m²").
Extract EVERY distinct dwelling-unit net area (apartments, studios, duplexes, penthouses, ground-floor units).
- INCLUDE: living units (appartement/studio/duplex/woning).
- EXCLUDE: terraces (terras/balkon), garages, cellars (kelder/berging/garage), common areas, individual room areas.
- If the same unit appears on multiple sheets, count it ONCE.
Return JSON: {"units":[{"label":"app 0.3A","net_m2":104.3}],"n_units":<int>,"sum_net_m2":<number>,"notes":"label format seen"}`;

function pickPages(buf, file) {
  // Reliable page selection by ROOM-LABEL text density (floor plans have many).
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 9e7 });
  const pages = t.split("\f");
  const kw = /slaapkamer|leefruimte|badkamer|keuken|terras|berging|inkomhal|traphal|nachthal|dressing|bureau/gi;
  const scored = pages.map((p, i) => ({ i, n: (p.match(kw) || []).length }));
  return scored.filter((s) => s.n >= 5).sort((a, b) => b.n - a.n).slice(0, 5).map((s) => s.i);
}
async function renderHi(buf, idx) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (const i of idx) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    let png = Buffer.from(pix.asPNG()), width = pix.getWidth();
    while (png.length > 2_600_000 && width > 1500) { width = Math.floor(width * 0.82); png = await sharp(Buffer.from(pix.asPNG())).resize({ width }).png().toBuffer(); }
    if (png.length <= 3_000_000) out.push(png.toString("base64"));
  }
  return out;
}
async function extract(images) {
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 3000, system: SYS, messages: [{ role: "user", content }] }) });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
  const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

const out = [];
for (const e of experts) {
  try {
    const buf = readFileSync(join(DIR, e.file));
    const r = await extract(await renderHi(buf, pickPages(buf, e.file)));
    if (!r) { console.error(`${e.ref}: geen extractie`); continue; }
    const net = r.sum_net_m2 || (r.units || []).reduce((s, u) => s + (u.net_m2 || 0), 0);
    const gross = e.cats.cat1.opp;
    const factor = net > 0 ? gross / net : null;
    out.push({ ref: e.ref, n_units: r.n_units, net, gross, factor: factor ? +factor.toFixed(3) : null });
    console.error(`${e.ref}: ${r.n_units} units, net ${Math.round(net)} m² → expert-bruto ${Math.round(gross)} m²  factor ${factor ? factor.toFixed(2) : "?"}`);
  } catch (err) { console.error(`${e.ref}: FOUT ${err.message}`); }
}
writeFileSync("scripts/sqm-netopp.json", JSON.stringify(out, null, 1));

const fs2 = out.map((d) => d.factor).filter((x) => x && x > 1 && x < 2.5).sort((a, b) => a - b);
const med = fs2[Math.floor(fs2.length / 2)];
const mean = fs2.reduce((s, x) => s + x, 0) / fs2.length;
console.log(`\n══ gross/net factor (n=${fs2.length}) ══  mediaan ${med?.toFixed(3)}  gem ${mean.toFixed(3)}  range ${fs2[0]?.toFixed(2)}–${fs2[fs2.length-1]?.toFixed(2)}`);
// MAE of net×factor vs expert gross, at the median factor
let mae = 0, n = 0;
for (const d of out) { if (!d.net) continue; const pred = d.net * med; mae += Math.abs(pred / d.gross - 1); n++; }
console.log(`Voorspel bruto = net × ${med?.toFixed(2)}:  mediaan-|Δ| ${(mae / n * 100).toFixed(1)}%  (n=${n})`);
