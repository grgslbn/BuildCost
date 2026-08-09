/**
 * chain-reader.mjs — Fase 1 van de SQM ±10% goal: agentic Tier-3 extractor.
 *
 * Repliceert de interactief-gevalideerde menselijke methode (26-552710 −0.5%, 23-483997 −4.2%)
 * als API-pipeline: een tool-loop waarin het model plan-pagina's bekijkt, INZOOMT op
 * maatketens (crop-tool — API downsampled alles naar ~1568px, dus zoomen is verplicht),
 * ketens sluit op eindmaten, verdiepingen telt uit sneden, en een gestructureerd rapport
 * aflevert met de ketens als bewijsmateriaal zodat code ze kan verifiëren.
 *
 * ANTI-CHEAT: berekening/oppervlaktestaat-pagina's worden gedetecteerd en NIET aan het
 * model gegeven (tenzij --allow-table), zodat de test eerlijk Tier-3 blijft.
 *
 * Usage: node scripts/chain-reader.mjs <ref|pdfpath> [--model=claude-opus-5] [--allow-table] [--max-turns=40]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const ARG = process.argv[2];
if (!ARG) { console.error("usage: node scripts/chain-reader.mjs <ref|pdfpath>"); process.exit(1); }
const MODEL = (process.argv.find((a) => a.startsWith("--model=")) || "").slice(8) || "claude-opus-5";
const ALLOW_TABLE = process.argv.includes("--allow-table");
const MAX_TURNS = parseInt((process.argv.find((a) => a.startsWith("--max-turns=")) || "").slice(12) || "40", 10);

// ---------- locate the PDF ----------
const SEARCH_DIRS = [
  "C:/Users/tieme/Mijn Drive/M²Value/field/ALL",
  "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building",
  "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie commercial",
  "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie woning",
];
let PDF = ARG;
if (!existsSync(PDF)) {
  const digits = ARG.replace("-", "");
  for (const d of SEARCH_DIRS) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d).find((f) => f.startsWith(ARG) || f.replace("-", "").startsWith(digits));
    if (hit) { PDF = join(d, hit); break; }
  }
}
if (!existsSync(PDF)) { console.error("PDF niet gevonden voor", ARG); process.exit(1); }
console.log("PDF:", PDF, "| model:", MODEL);

// ---------- page analysis (text layer) ----------
const TABLE_RE = /Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl|Surf\/contenu/i;
let fullText = "";
try { fullText = execFileSync("pdftotext", ["-layout", PDF, "-"], { encoding: "utf8", maxBuffer: 2e8 }); } catch { /* scanned */ }
const pageTexts = fullText.split("\f");
const buf = readFileSync(PDF);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const N = doc.countPages();
const blocked = new Set();
if (!ALLOW_TABLE) pageTexts.forEach((p, i) => { if (TABLE_RE.test(p)) blocked.add(i); });
console.log(`pagina's: ${N}, geblokkeerd (berekening): ${[...blocked].join(",") || "geen"}`);

// ---------- rendering helpers ----------
function renderPage(i, maxPx = 1568) {
  const page = doc.loadPage(i);
  const [x0, y0, x1, y1] = page.getBounds();
  const wPts = x1 - x0, hPts = y1 - y0;
  const scale = Math.min(maxPx / wPts, maxPx / hPts, 8);
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  return { png: Buffer.from(pix.asPNG()), w: pix.getWidth(), h: pix.getHeight() };
}
async function renderCrop(i, fx, fy, fw, fh) {
  const page = doc.loadPage(i);
  const [x0, y0, x1, y1] = page.getBounds();
  const wPts = x1 - x0, hPts = y1 - y0;
  fw = Math.min(Math.max(fw, 0.02), 1); fh = Math.min(Math.max(fh, 0.02), 1);
  fx = Math.min(Math.max(fx, 0), 1 - fw); fy = Math.min(Math.max(fy, 0), 1 - fh);
  const scale = Math.min(1500 / (fw * wPts), 1500 / (fh * hPts), 14);
  const left = Math.floor((x0 + fx * wPts) * scale), top = Math.floor((y0 + fy * hPts) * scale);
  const cw = Math.ceil(fw * wPts * scale), ch = Math.ceil(fh * hPts * scale);
  try {
    // clipped render: only the requested region is rasterized (A0-safe)
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [left, top, left + cw, top + ch], false);
    pix.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    page.run(dev, mupdf.Matrix.scale(scale, scale));
    dev.close();
    return await sharp(Buffer.from(pix.asPNG()))
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).flatten({background:"#ffffff"}).jpeg({ quality: 82 }).toBuffer();
  } catch {
    // fallback: bounded full render + extract
    const s2 = Math.min(scale, Math.sqrt(8e7 / (wPts * hPts)));
    const pix = page.toPixmap(mupdf.Matrix.scale(s2, s2), mupdf.ColorSpace.DeviceRGB, false, true);
    const fullW = pix.getWidth(), fullH = pix.getHeight();
    const l2 = Math.min(Math.floor(fx * fullW), fullW - 2), t2 = Math.min(Math.floor(fy * fullH), fullH - 2);
    const w2 = Math.max(2, Math.min(Math.ceil(fw * fullW), fullW - l2)), h2 = Math.max(2, Math.min(Math.ceil(fh * fullH), fullH - t2));
    return await sharp(Buffer.from(pix.asPNG())).extract({ left: l2, top: t2, width: w2, height: h2 })
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).flatten({background:"#ffffff"}).jpeg({ quality: 82 }).toBuffer();
  }
}
async function thumb(i, width = 340) {
  const { png } = renderPage(i, 1000);
  return sharp(png).resize({ width }).jpeg({ quality: 62 }).toBuffer();
}
const b64 = (b, mt = "image/png") => ({ type: "image", source: { type: "base64", media_type: mt, data: b.toString("base64") } });

// ---------- tools ----------
const tools = [
  {
    name: "view_page",
    description: "Bekijk één pagina op volledige grootte (max ~1568px — kleine tekst is dan ONLEESBAAR op grote bladen; gebruik crop om te lezen).",
    input_schema: { type: "object", properties: { page: { type: "integer" } }, required: ["page"], additionalProperties: false },
  },
  {
    name: "crop",
    description: "Zoom in op een deel van een pagina om maatketens, labels en kleine tekst te LEZEN. Coördinaten als fracties van de pagina (x,y = linksboven van de regio; w,h = breedte/hoogte). Kleinere regio = meer zoom. Gebruik dit veelvuldig — dit is de enige manier om maatcijfers op A0/A1-bladen te lezen.",
    input_schema: {
      type: "object",
      properties: { page: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
      required: ["page", "x", "y", "w", "h"], additionalProperties: false,
    },
  },
  {
    name: "report",
    description: "Lever het eindresultaat af. Alleen aanroepen wanneer elke verdieping gemeten of expliciet als onzichtbaar geflagd is.",
    input_schema: {
      type: "object",
      properties: {
        floors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "bv. 'kelder -1', 'gelijkvloers', 'verdieping +2', 'dak'" },
              page: { type: "integer", description: "pagina waarop gemeten" },
              cat: { type: "string", enum: ["cat1", "cat2", "cat3", "mixed", "excluded"] },
              method: { type: "string", enum: ["dimension_chains", "printed_label", "calibrated_element", "inferred_from_other_floor"] },
              shape: {
                type: "array", description: "rechthoek-decompositie van de verdieping",
                items: { type: "object", properties: { w_m: { type: "number" }, d_m: { type: "number" }, sign: { type: "integer", description: "1 = toevoegen, -1 = aftrekken (uitsparing/vide)" } }, required: ["w_m", "d_m", "sign"], additionalProperties: false },
              },
              width_chain: { type: "array", items: { type: "number" }, description: "gelezen ketensegmenten (m) langs de breedte, indien gelezen" },
              width_total: { type: "number", description: "de gedrukte EINDmaat van die keten indien aanwezig" },
              depth_chain: { type: "array", items: { type: "number" } },
              depth_total: { type: "number" },
              area_m2: { type: "number" },
              cat_split: { type: "object", properties: { cat1: { type: "number" }, cat2: { type: "number" }, cat3: { type: "number" } }, additionalProperties: false, description: "verplicht bij cat='mixed'" },
              notes: { type: "string" },
            },
            required: ["label", "page", "cat", "method", "area_m2"], additionalProperties: false,
          },
        },
        cat1_m2: { type: "number" }, cat2_m2: { type: "number" }, cat3_m2: { type: "number" },
        floor_count_from_sections: { type: "integer", description: "aantal bouwlagen geteld uit snede/gevel, -1 indien geen snede aanwezig" },
        flags: { type: "array", items: { type: "string" }, description: "bv. 'kelder onzichtbaar — ondergrens', 'schaal onleesbaar', 'duplicaat NL/FR bladen'" },
        confidence: { type: "number", description: "0..1" },
        notes: { type: "string" },
      },
      required: ["floors", "cat1_m2", "cat2_m2", "cat3_m2", "floor_count_from_sections", "flags", "confidence"],
      additionalProperties: false,
    },
  },
];

const SYSTEM = `Je bent een expert bouwkundig meetkundige. Je meet de BRUTO vloeroppervlakte per verdieping uit Belgische bouwplannen, zoals een menselijke expert dat doet: door MAATKETENS te lezen, niet door pixels te schatten.

METHODE (volg strikt):
1. ORIËNTATIE: bekijk eerst de paginaminiaturen. Identificeer: grondplannen (per verdieping), snedes (coupe/doorsnede), gevels, inplanting, titelblok (schaal!). Negeer foto's, kadasterkaarten, verslagen. Let op duplicaten (zelfde plan 2x gebonden, of NL+FR versie) — tel die maar één keer.
2. VERDIEPINGEN ENUMEREREN: maak de volledige lijst bouwlagen (kelder(s), gelijkvloers, verdiepingen, dakverdieping). Cross-check het aantal lagen met de snede/gevel. Als er GEEN kelderplan én GEEN snede is: flag "ondergrondse niveaus onzichtbaar — schatting is ondergrens".
3. PER VERDIEPING METEN: zoom met crop in op de maatketens aan de randen van het plan. Lees de buitenste keten (= gebouwenvelop). VERIFIEER: de segmenten van een keten moeten sommeren tot de eindmaat die eronder/ernaast gedrukt staat. Als dat niet klopt heb je verkeerd gelezen — zoom verder in en lees opnieuw. Noteer de ketens in je rapport.
4. OPPERVLAK: decomposeer niet-rechthoekige vormen in rechthoeken (shape-array, sign -1 voor uitsparingen). Vides/traphallen tellen mee in bruto opp (alleen echte open vides > 4 m² aftrekken). Maten in mm of cm op het plan → converteer naar meters (Belgische plannen: meestal cm of mm; 450 = 4,50 m).
5. ALS ER GEEN DOORLOPENDE BUITENKETEN IS: benader de verdieping NIET via een geschatte envelop. Werk dan van binnen naar buiten: sommeer de gedrukte BINNENmaten van de ruimtes langs één as + muurdiktes, en SLUIT die som op een gedrukte totaalmaat of op de som van een andere as. Doe dit voor minstens twee assen per verdieping. Identieke verdiepingen (zelfde plattegrond -1/0/+1): meet er één volledig en verifieer de andere met een steekproefmaat i.p.v. het resultaat blind te kopiëren.
5b. ALS KETENS ONLEESBAAR ZIJN (scan te slecht): kalibreer met standaardelementen — parkeerplaats 2,50 m breed, deur 0,90 m, traptrede 0,25 m — en zeg dat in method='calibrated_element'. Dit is een noodgreep, meld lagere confidence.
5c. ZELFCONTROLE vóór report: hermeet de GROOTSTE verdieping één keer onafhankelijk via een andere weg (andere keten, andere as, of som van ruimtes) en vergelijk. Wijkt de tweede meting >8% af van de eerste: onderzoek waarom, en als het niet oplosbaar is → confidence < 0.6 en flag de discrepantie.
6. CONVENTIE OPPERVLAKTE (STRIKT): area_m2 van een verdieping = de OMSLOTEN bruto vloeroppervlakte (buitenwerks gemeten, ZONDER open terrassen/balkons — meet tot de gevellijn, niet tot de terrasrand). Elk terras/balkon/dakterras komt als APARTE floor-regel (bv. "terrassen +2"): open/uitkragend → cat3; inpandig (binnen het gebouwvolume) → cat1. Dit spiegelt de CED-tabellen, die terrassen als aparte rijen voeren. Pas deze conventie op ELKE verdieping identiek toe.
6b-cat. CATEGORIEËN (Belgische herbouwwaarde-conventie):
   - cat1 = verwarmd/afgewerkt: woonruimtes, appartementen, kantoren, handelsgelijkvloers, gemeenschappelijke circulatie (traphal/gang/lift), INPANDIGE (in het volume liggende) terrassen.
   - cat2 = niet-verwarmd overdekt: garage, parkeerkelder, kelder/berging, techniek, zolder onafgewerkt.
   - cat3 = buiten GEBOUWD (een gedragen constructie): vrij uitkragende balkons, dakterrassen, terrassen op een kelderdak.
   - excluded = TERRASSEN OP MAAIVELD/VOLLE GROND (tegels/kasseien in de tuin = buitenaanleg, geen m²), groendak, tuin, zwemvijver, OPEN CARPORTS en open afdaken (aparte post), open hellingbanen.
   - VIDES in een woning: de vloeropening zelf telt NIET mee op de verdieping waar hij zit (meet de werkelijke vloerplaat); trek geen extra af.
5e. DAKVERDIEPINGEN/ZOLDERS onder een schuin dak: de expert telt de BEWOONBARE oppervlakte (vrije hoogte ≥ ±1,5 m), niet de volle vloerplaat. Bepaal het bewoonbare deel via de snede (knikhoogte/dakhelling); zonder snede: neem ±75% van de plaat en flag dat. Afgewerkte dakverdieping → cat1 (bewoonbaar deel). Het deel onder de knik telt NERGENS mee — ook niet als cat2; zet het niet in een cat_split. Alleen een APARTE onafgewerkte bergzolder (eigen niveau, via trap/luik) is cat2.
5f. DOMEINEN MET MEERDERE GEBOUWEN: begin bij het INPLANTINGSPLAN en nummer ALLE gebouwen (hoofdgebouw + elk bijgebouw). Elk gebouw moet in je floors-lijst voorkomen — gemeten, of expliciet geflagd als "niet getekend". Controleer per bijgebouw of er een bovenverdieping is (aparte plattegrond, dakvensters op de gevel, trap op het grondplan). Een vergeten bijgebouw is de grootste foutbron op domeinen.
5d. KELDERS & PARKEERLAGEN krijgen dezelfde ketenstrengheid als woonlagen — dit is een bewezen zwakte. Een parkeerkelder is vaak GROTER dan de bovenbouw-voetafdruk (uitkraging onder tuin/plein). Meet de kelderenvelop uit het kelderplan zelf, nooit gekopieerd van een bovenliggende laag. Cross-check bij parkeerlagen: aantal vakken × ±25 m²/vak (incl. circulatie) moet grosso modo kloppen met je envelopmeting; groot verschil = hermeten.
6b. HUIDIG GEBRUIK ≠ PLAN: bouwplannen kunnen jaren oud zijn; functies kunnen gewijzigd zijn (opslag → woning, zolder → duplex). Als het dossier verslag-/tekstpagina's bevat (expertiseverslag, beschrijving): lees daar de HUIDIGE functie van elk gebouwdeel en het aantal bouwlagen, en gebruik die voor de cat-toewijzing — het verslag beschrijft de actuele toestand, het plan mogelijk een oude. Wijkt de functie af van het plan: volg het verslag en flag de wijziging. (Getallen/oppervlaktes uit het verslag overnemen mag NIET — alleen functies, gebruik en aantallen lagen.)
7. RAPPORT: pas report aanroepen als elke bouwlaag gemeten of geflagd is. Wees eerlijk in confidence: ketens gelezen en gesloten = hoog; gekalibreerd/gegokt = laag.

BELANGRIJK: op een volledig weergegeven A0/A1-blad zijn maatcijfers ONLEESBAAR (alles wordt naar ~1568px geschaald). Je MOET croppen om te lezen. Werk systematisch: eerst overzicht, dan per verdieping de ketens. Reken zorgvuldig; controleer elke som twee keer.`;

// ---------- build initial message ----------
const visible = [...Array(N).keys()].filter((i) => !blocked.has(i));
const MAX_THUMBS = 42;
const thumbPages = visible.slice(0, MAX_THUMBS);
const content = [{
  type: "text",
  text: `Dossier: ${basename(PDF)}. ${N} pagina's; jij krijgt ${visible.length} pagina's (berekeningspagina's zijn bewust verwijderd — je moet zelf meten). Hieronder miniaturen van pagina's [${thumbPages.join(", ")}]${visible.length > MAX_THUMBS ? ` (rest opvraagbaar via view_page: ${visible.slice(MAX_THUMBS).join(", ")})` : ""}. Meet de bruto vloeroppervlakte per verdieping en rapporteer cat1/cat2/cat3.`,
}];
for (const i of thumbPages) {
  content.push({ type: "text", text: `p${i}:` });
  content.push(b64(await thumb(i), "image/jpeg"));
}

// ---------- agent loop ----------
const messages = [{ role: "user", content }];
let report = null, turns = 0, toolCalls = 0;
const t0 = Date.now();
function setCacheBreakpoint(msgs) {
  // one breakpoint on the newest block — caches tools+system+entire prior history
  for (const m of msgs) if (Array.isArray(m.content)) for (const c of m.content) delete c.cache_control;
  const last = msgs[msgs.length - 1];
  if (Array.isArray(last.content) && last.content.length) last.content[last.content.length - 1].cache_control = { type: "ephemeral" };
}
while (turns < MAX_TURNS && !report) {
  turns++;
  setCacheBreakpoint(messages);
  const params = {
    model: MODEL, max_tokens: 32000, system: SYSTEM, tools, messages,
  };
  let msg;
  for (let a = 0; a < 5; a++) {
    try {
      const stream = client.messages.stream(params);
      msg = await stream.finalMessage();
      break;
    } catch (e) {
      const st = e?.status || 0;
      if (st === 429 || st >= 500 || /overloaded/i.test(String(e))) { await new Promise((r) => setTimeout(r, 8000 * (a + 1))); continue; }
      throw e;
    }
  }
  if (!msg) throw new Error("API bleef falen");
  if (msg.stop_reason === "refusal") { console.error("REFUSAL:", JSON.stringify(msg.stop_details)); process.exit(2); }

  const toolUses = msg.content.filter((b) => b.type === "tool_use");
  for (const b of msg.content) if (b.type === "text" && b.text.trim()) console.log(`[t${turns}]`, b.text.trim().slice(0, 300));
  messages.push({ role: "assistant", content: msg.content });
  if (toolUses.length === 0) { console.log("model stopte zonder report (stop:", msg.stop_reason, ")"); break; }

  const results = [];
  for (const tu of toolUses) {
    toolCalls++;
    try {
      if (tu.name === "report") {
        report = tu.input;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "rapport ontvangen" });
      } else if (tu.name === "view_page") {
        const i = tu.input.page;
        if (blocked.has(i) || i < 0 || i >= N) { results.push({ type: "tool_result", tool_use_id: tu.id, content: "pagina niet beschikbaar", is_error: true }); continue; }
        const { png } = renderPage(i);
        const jpg = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
        results.push({ type: "tool_result", tool_use_id: tu.id, content: [b64(jpg, "image/jpeg")] });
        console.log(`  view_page(${i})`);
      } else if (tu.name === "crop") {
        const { page, x, y, w, h } = tu.input;
        if (blocked.has(page) || page < 0 || page >= N) { results.push({ type: "tool_result", tool_use_id: tu.id, content: "pagina niet beschikbaar", is_error: true }); continue; }
        const jpg2 = await renderCrop(page, x, y, w, h);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: [b64(jpg2, "image/jpeg")] });
        console.log(`  crop(p${page} x=${x.toFixed(2)} y=${y.toFixed(2)} w=${w.toFixed(2)} h=${h.toFixed(2)})`);
      } else {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "onbekende tool", is_error: true });
      }
    } catch (e) {
      results.push({ type: "tool_result", tool_use_id: tu.id, content: String(e.message || e).slice(0, 200), is_error: true });
    }
  }
  messages.push({ role: "user", content: results });
}

if (!report) { console.error("GEEN RAPPORT na", turns, "beurten"); process.exit(3); }

// ---------- deterministic verification ----------
const problems = [];
for (const f of report.floors || []) {
  for (const [chain, total, lbl] of [[f.width_chain, f.width_total, "breedte"], [f.depth_chain, f.depth_total, "diepte"]]) {
    if (chain?.length && total) {
      const s = chain.reduce((a, b) => a + b, 0);
      if (Math.abs(s - total) / total > 0.03) problems.push(`${f.label}: ${lbl}-keten som ${s.toFixed(2)} ≠ eindmaat ${total} (${((s / total - 1) * 100).toFixed(1)}%)`);
    }
  }
  if (f.shape?.length) {
    const sa = f.shape.reduce((a, r) => a + r.sign * r.w_m * r.d_m, 0);
    if (f.area_m2 > 0 && Math.abs(sa - f.area_m2) / f.area_m2 > 0.05) problems.push(`${f.label}: shape-som ${sa.toFixed(1)} ≠ area ${f.area_m2}`);
  }
}
const sums = { cat1: 0, cat2: 0, cat3: 0 };
for (const f of report.floors || []) {
  if (f.cat === "mixed" && f.cat_split) { sums.cat1 += f.cat_split.cat1 || 0; sums.cat2 += f.cat_split.cat2 || 0; sums.cat3 += f.cat_split.cat3 || 0; }
  else if (sums[f.cat] !== undefined) sums[f.cat] += f.area_m2;
}
for (const c of ["cat1", "cat2", "cat3"]) {
  const rep = report[`${c}_m2`] || 0;
  if (rep > 0 && Math.abs(sums[c] - rep) / rep > 0.05) problems.push(`${c}: verdiepingssom ${sums[c].toFixed(0)} ≠ gerapporteerd ${rep}`);
}

// ---------- output + GT compare ----------
const ref = (basename(PDF).match(/^(\d{2})-?(\d{6})/) || []);
const refKey = ref.length ? `${ref[1]}-${ref[2]}` : null;
let gt = null;
try { gt = JSON.parse(readFileSync(join(ROOT, "scripts", "sqm-groundtruth.json"), "utf8"))[refKey] || null; } catch { /* none */ }
if (!gt) {
  try {
    const a = JSON.parse(readFileSync(join(ROOT, "scripts", "gt-auto.json"), "utf8"))[refKey];
    if (a) gt = { strict_cat1: a.cat1_m2, cat2_m2: a.cat2_m2, cat3_m2: a.cat3_m2, source: "gt-auto" };
  } catch { /* none */ }
}

const out = { ref: refKey, model: MODEL, turns, toolCalls, minutes: +((Date.now() - t0) / 60000).toFixed(1), report, verification: { problems, floorSums: sums }, gt };
console.log("\n=== RAPPORT ===");
console.log(JSON.stringify(report, null, 2).slice(0, 4000));
console.log("\nverificatie:", problems.length ? problems : "OK");
if (gt) {
  const d = (a, b) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : "n/a");
  console.log(`\nGT: cat1 ${gt.strict_cat1 || gt.heated_m2} → Δ ${d(report.cat1_m2, gt.strict_cat1 || gt.heated_m2)}` +
    (gt.cat2_m2 ? ` | cat2 ${gt.cat2_m2} → Δ ${d(report.cat2_m2, gt.cat2_m2)}` : "") +
    (gt.cat3_m2 ? ` | cat3 ${gt.cat3_m2} → Δ ${d(report.cat3_m2, gt.cat3_m2)}` : ""));
}
writeFileSync(join(ROOT, "scripts", `chain-${refKey || "out"}-${MODEL.replace(/[^a-z0-9]/gi, "")}.json`), JSON.stringify(out, null, 2));
console.log(`\nklaar in ${out.minutes} min, ${toolCalls} tool calls, ${turns} beurten`);
