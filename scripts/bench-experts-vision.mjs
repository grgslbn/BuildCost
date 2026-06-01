/**
 * bench-experts-vision.mjs — robustly extract the expert berekening from every
 * VerzamelPDF via Claude vision (handles all table formats). Finds the berekening
 * page(s), renders them, extracts structured rows → scripts/bench-experts.json.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const AKEY = env.ANTHROPIC_API_KEY;
const DIR = process.argv[2] || "C:/Users/tieme/Desktop/testing 30_5";
const OUTFILE = process.argv[3] || "scripts/bench-experts.json";
const files = readdirSync(DIR).filter((f) => /VerzamelPDF.*\.pdf$/i.test(f) && !/- kopie/i.test(f));

const SYS = `You extract data from a Belgian CED/AXA insurance reconstruction-cost calculation table ("Berekening"). Read the table and return ONLY JSON.`;
const schemaInstr = `Return JSON:
{"building_type":"appartementsgebouw|winkel|woning|...",
 "rows":[{"omschrijving":"...","niveau":"...","opp_m2":<number or null>,"waarde_eur":<number>}],
 "total_eur":<number>,"abex":<number or null>}
Rules: opp_m2 = the Oppervlakte/Opp value in m² (null if the row has no area, e.g. lift/zonnepanelen/buitenaanleg). waarde_eur = the value in € (incl btw). Numbers: Belgian format (1.657,60 → 1657.60). Include EVERY row of the calculation table. Do not invent rows.`;

function findBerekeningPages(file) {
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 8e7 });
  const pages = t.split("\f");
  const idx = [];
  for (let i = 0; i < pages.length; i++) {
    if (/Totaal kapitaal in nieuwbouwwaarde|NIEUWBOUWWAARDE\s+INCLUSIEF|^\s*Berekening\s*$|appartementsgebouw|Opp\/inhoud|Oppervlakte\s+incl/im.test(pages[i])) idx.push(i);
  }
  return [...new Set(idx)];
}

async function extractPage(buf, pageIdx) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const imgs = [];
  for (const i of pageIdx.slice(0, 3)) {
    if (i >= doc.countPages()) continue;
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(170 / 72, 170 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    let b64 = Buffer.from(pix.asPNG()).toString("base64");
    if (b64.length > 4_800_000) continue;
    imgs.push(b64);
  }
  if (!imgs.length) return null;
  const content = [{ type: "text", text: schemaInstr }, ...imgs.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 3000, system: SYS, messages: [{ role: "user", content }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 200));
  const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

function classify(d) {
  d = (d || "").toLowerCase();
  if (/terras|balkon|dakterras|groendak/.test(d)) return "cat3";
  if (/appartement|woning|woon|winkel|handels|kantoor|burel|bureel|studio|leefr|duplex/.test(d)) return "cat1";
  if (/kelder|garage|berging|techniek|parking|staanplaats|inrit|fietsberg|afvalberg|gemeenschapp|circulati|technische|opslag/.test(d)) return "cat2";
  return "other";
}

const out = [];
for (const f of files) {
  const ref = f.match(/^(\d{2}-\d+?)\d{5}Verzamel/)?.[1] || f.slice(0, 12);
  try {
    const buf = readFileSync(join(DIR, f));
    const pidx = findBerekeningPages(f);
    const data = await extractPage(buf, pidx);
    if (!data) { console.error(`${ref}: geen extractie`); continue; }
    const cats = { cat1: { opp: 0, val: 0 }, cat2: { opp: 0, val: 0 }, cat3: { opp: 0, val: 0 }, other: { opp: 0, val: 0 } };
    for (const r of data.rows || []) {
      const cat = classify(r.omschrijving);
      const opp = typeof r.opp_m2 === "number" ? r.opp_m2 : 0;
      const val = typeof r.waarde_eur === "number" ? r.waarde_eur : 0;
      cats[cat].opp += opp; cats[cat].val += val;
    }
    out.push({ ref, file: f, building_type: data.building_type, total: data.total_eur, abex: data.abex, cats, woonEur: cats.cat1.opp ? Math.round(cats.cat1.val / cats.cat1.opp) : null, rows: data.rows });
    console.error(`${ref}: ${data.rows?.length} rows, totaal €${(data.total_eur||0).toLocaleString("nl-BE")}`);
  } catch (e) { console.error(`${ref}: FOUT ${e.message}`); }
}

writeFileSync(OUTFILE, JSON.stringify(out, null, 1));
console.log("\nDossier".padEnd(12) + "type".padEnd(14) + "Totaal".padStart(14) + "ABEX".padStart(6) + " woon m²".padStart(9) + " woon€/m²".padStart(10) + " niet m²".padStart(9) + " terras".padStart(8));
console.log("─".repeat(82));
for (const d of out) console.log(
  d.ref.padEnd(12) + String(d.building_type||"?").slice(0,13).padEnd(14) +
  ("€" + Math.round(d.total||0).toLocaleString("nl-BE")).padStart(14) + String(d.abex??"?").padStart(6) +
  String(Math.round(d.cats.cat1.opp)).padStart(9) + ("€"+(d.woonEur??"?")).padStart(10) +
  String(Math.round(d.cats.cat2.opp)).padStart(9) + String(Math.round(d.cats.cat3.opp)).padStart(8));
console.log("\n→ scripts/bench-experts.json (" + out.length + " dossiers)");
