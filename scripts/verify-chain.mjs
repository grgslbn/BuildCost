/**
 * verify-chain.mjs — Fase 2: onafhankelijke verificatie-agent (adversarial second pass).
 * Vers-contextige agent die, ZONDER het primaire resultaat te kennen tijdens het meten:
 *  1. de grootste cat1-verdieping uit het primaire rapport ONAFHANKELIJK hermeet (crop-tools),
 *  2. daarna de categorie-toewijzing van het primaire rapport auditeert tegen de
 *     verslag-/tekstpagina's (huidig gebruik per gebouwdeel).
 * Gate-besluit: AUTO alleen als hermeting binnen 8% van primair EN geen allocatie-issues.
 *
 * Output: scripts/verify-<ref>-<model>.json
 * Usage: node scripts/verify-chain.mjs <ref> [--model=claude-opus-5]
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
const REF = process.argv[2];
const MODEL = (process.argv.find((a) => a.startsWith("--model=")) || "").slice(8) || "claude-opus-5";
const slug = MODEL.replace(/[^a-z0-9]/gi, "");
const primary = JSON.parse(readFileSync(join(ROOT, "scripts", `chain-${REF}-${slug}.json`), "utf8"));

const SEARCH_DIRS = ["C:/Users/tieme/Mijn Drive/M²Value/field/ALL", "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building"];
let PDF = null;
const digits = REF.replace("-", "");
for (const d of SEARCH_DIRS) { if (!existsSync(d)) continue; const hit = readdirSync(d).find((f) => f.replace("-", "").startsWith(digits)); if (hit) { PDF = join(d, hit); break; } }
if (!PDF) { console.error("PDF niet gevonden"); process.exit(1); }

const TABLE_RE = /Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl|Surf\/contenu/i;
let fullText = "";
try { fullText = execFileSync("pdftotext", ["-layout", PDF, "-"], { encoding: "utf8", maxBuffer: 2e8 }); } catch { /* */ }
const pageTexts = fullText.split("\f");
const doc = mupdf.Document.openDocument(readFileSync(PDF), "application/pdf");
const N = doc.countPages();
const blocked = new Set();
pageTexts.forEach((p, i) => { if (TABLE_RE.test(p)) blocked.add(i); });

// grootste cat1-verdieping uit primair rapport
const cat1Floors = (primary.report.floors || []).filter((f) => f.cat === "cat1" || f.cat === "mixed");
if (!cat1Floors.length) { console.log("geen cat1-verdiepingen — niets te verifiëren"); process.exit(0); }
const sorted = cat1Floors.sort((a, b) => b.area_m2 - a.area_m2);
const target = sorted[0];
const target2 = sorted.length > 1 ? sorted[1] : null;

function renderPage(i, maxPx = 1568) {
  const page = doc.loadPage(i);
  const [x0, y0, x1, y1] = page.getBounds();
  const scale = Math.min(maxPx / (x1 - x0), maxPx / (y1 - y0), 8);
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  return Buffer.from(pix.asPNG());
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
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [left, top, left + cw, top + ch], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
  page.run(dev, mupdf.Matrix.scale(scale, scale));
  dev.close();
  return sharp(Buffer.from(pix.asPNG())).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).flatten({background:"#ffffff"}).jpeg({ quality: 82 }).toBuffer();
}
const b64 = (b, mt = "image/png") => ({ type: "image", source: { type: "base64", media_type: mt, data: b.toString("base64") } });
async function pageJpg(i) { return sharp(renderPage(i)).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer(); }

const tools = [
  { name: "crop", description: "Zoom in op een pagina-regio (fracties x,y,w,h) om maatketens te lezen.", input_schema: { type: "object", properties: { page: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["page", "x", "y", "w", "h"], additionalProperties: false } },
  { name: "view_page", description: "Bekijk een volledige pagina (~1568px).", input_schema: { type: "object", properties: { page: { type: "integer" } }, required: ["page"], additionalProperties: false } },
  {
    name: "verdict", description: "Lever je verificatie-oordeel af.",
    input_schema: {
      type: "object",
      properties: {
        remeasured_area_m2: { type: "number", description: "jouw onafhankelijke meting van doelverdieping 1" },
        remeasured_area2_m2: { type: "number", description: "jouw onafhankelijke meting van doelverdieping 2 (0 indien geen tweede doel)" },
        method: { type: "string" },
        allocation_issues: {
          type: "array", description: "alleen MATERIËLE cat-toewijzingsfouten (leeg indien geen)",
          items: { type: "object", properties: { beschrijving: { type: "string" }, impact_m2: { type: "number", description: "geschatte m² die van categorie wisselen of vervallen" }, van_cat: { type: "string" }, naar_cat: { type: "string" } }, required: ["beschrijving", "impact_m2", "van_cat", "naar_cat"], additionalProperties: false },
        },
        missing_parts: {
          type: "array", description: "alleen MATERIËLE ontbrekende gebouwdelen",
          items: { type: "object", properties: { beschrijving: { type: "string" }, impact_m2: { type: "number" }, cat: { type: "string" } }, required: ["beschrijving", "impact_m2", "cat"], additionalProperties: false },
        },
        notes: { type: "string" },
      },
      required: ["remeasured_area_m2", "remeasured_area2_m2", "method", "allocation_issues", "missing_parts"], additionalProperties: false,
    },
  },
];

const SYSTEM = `Je bent een onafhankelijke controleur van bouwoppervlakte-metingen. Je hermeet EERST zelf (fase A) en auditeert DAARNA de toewijzing (fase B). In fase A mag je je niet laten leiden door andermans resultaat — je meet blind en rapporteert wat JIJ vindt. Lees maatketens via crop; sluit segmentsommen op eindmaten; decomposeer in rechthoeken.

CONVENTIE: verdiepingsoppervlakte = OMSLOTEN bruto (buitenwerks, tot de gevellijn, ZONDER open terrassen/balkons — die horen in aparte terras-regels). Dakverdiepingen: alleen het bewoonbare deel (vrije hoogte ≥1,5 m); onder de knik telt nergens. cat3 = alleen gebouwde/gedragen buitenconstructies (balkon, dakterras, terras op kelderdak); terrassen op maaiveld = buitenaanleg, GEEN m² (dus ook geen missing part). Open carports/afdaken = aparte post, geen m². Hanteer dit ook in je eigen hermeting en audit.

In fase B vergelijk je de verdiepingslijst met wat plan + verslagtekst tonen (huidig gebruik per gebouwdeel; oude plannen kunnen functiewijzigingen missen). VERPLICHT bij fase B: (1) zoek het inplantingsplan, tel ALLE gebouwen en controleer dat elk gebouw(deel) in de lijst staat — een ontbrekend gebouw of ontbrekende verdieping van een bijgebouw is ALTIJD materieel; (2) controleer bij dakverdiepingen of de bewoonbare-oppervlakte-conventie (vrije hoogte ≥1,5 m) is toegepast i.p.v. de volle vloerplaat. Rapporteer ALLEEN materiële kwesties: een issue is materieel als de kostenimpact ruwweg ≥3% van het geheel is (cat1≈€2040/m², cat2≈€1200/m², cat3≈€700/m²). Functienuances binnen dezelfde categorie (kantoor vs handel: beide cat1) zijn NIET materieel. Kwantificeer elke kwestie in impact_m2. Werk doelgericht: max ~20 beurten, roep dan verdict aan.`;

const floorList = (primary.report.floors || []).map((f) => `- ${f.label}: ${f.area_m2} m² (${f.cat})`).join("\n");
const hidden = new Set([target.label, target2?.label].filter(Boolean));
const listShown = (primary.report.floors || []).map((f) => `- ${f.label}: ${hidden.has(f.label) ? "[VERBORGEN]" : f.area_m2 + " m²"} (${f.cat})`).join("\n");
const content = [{
  type: "text",
  text: `FASE A — hermeet ONAFHANKELIJK (blind) deze doelverdieping(en):
1. "${target.label}" (pagina ${target.page})${target2 ? `
2. "${target2.label}" (pagina ${target2.page})` : ""}
De eerdere resultaten zijn bewust verborgen.

FASE B — daarna: controleer de verdiepingslijst hieronder op cat-toewijzing (huidig gebruik! lees de verslag-/tekstpagina's als die er zijn) en op ontbrekende gebouwdelen. Alleen materiële kwesties, gekwantificeerd in m².

${listShown}

Roep daarna verdict aan (remeasured_area2_m2 = 0 als er geen tweede doel is).`,
}];
content.push({ type: "text", text: `p${target.page}:` }, b64(await pageJpg(target.page), "image/jpeg"));
if (target2 && target2.page !== target.page) content.push({ type: "text", text: `p${target2.page}:` }, b64(await pageJpg(target2.page), "image/jpeg"));

const messages = [{ role: "user", content }];
let verdict = null, turns = 0;
while (turns < 26 && !verdict) {
  turns++;
  for (const m of messages) if (Array.isArray(m.content)) for (const c of m.content) delete c.cache_control;
  const lastM = messages[messages.length - 1];
  if (Array.isArray(lastM.content) && lastM.content.length) lastM.content[lastM.content.length - 1].cache_control = { type: "ephemeral" };
  let msg;
  for (let a = 0; a < 5; a++) {
    try { const s = client.messages.stream({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages }); msg = await s.finalMessage(); break; }
    catch (e) { if (e?.status === 429 || e?.status >= 500) { await new Promise((r) => setTimeout(r, 8000 * (a + 1))); continue; } throw e; }
  }
  messages.push({ role: "assistant", content: msg.content });
  const tus = msg.content.filter((b) => b.type === "tool_use");
  if (!tus.length) break;
  const results = [];
  for (const tu of tus) {
    try {
      if (tu.name === "verdict") { verdict = tu.input; results.push({ type: "tool_result", tool_use_id: tu.id, content: "ok" }); }
      else if (tu.name === "view_page") {
        const i = tu.input.page;
        if (blocked.has(i) || i < 0 || i >= N) { results.push({ type: "tool_result", tool_use_id: tu.id, content: "pagina niet beschikbaar", is_error: true }); continue; }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: [b64(await pageJpg(i), "image/jpeg")] });
      } else {
        const { page, x, y, w, h } = tu.input;
        if (blocked.has(page) || page < 0 || page >= N) { results.push({ type: "tool_result", tool_use_id: tu.id, content: "pagina niet beschikbaar", is_error: true }); continue; }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: [b64(await renderCrop(page, x, y, w, h), "image/jpeg")] });
      }
    } catch (e) { results.push({ type: "tool_result", tool_use_id: tu.id, content: String(e.message || e).slice(0, 150), is_error: true }); }
  }
  messages.push({ role: "user", content: results });
}

if (!verdict) { console.error("geen verdict"); process.exit(3); }
const primArea = target.area_m2;
const dev = Math.abs(verdict.remeasured_area_m2 - primArea) / primArea;
const dev2 = target2 && verdict.remeasured_area2_m2 > 0 ? Math.abs(verdict.remeasured_area2_m2 - target2.area_m2) / target2.area_m2 : 0;
const P = { cat1: 2040, cat2: 1200, cat3: 700 };
const totCost = (primary.report.cat1_m2 || 0) * P.cat1 + (primary.report.cat2_m2 || 0) * P.cat2 + (primary.report.cat3_m2 || 0) * P.cat3;
let impactCost = 0;
for (const i of verdict.allocation_issues || []) impactCost += Math.abs((i.impact_m2 || 0) * ((P[i.naar_cat] || 0) - (P[i.van_cat] || 0)));
for (const i of verdict.missing_parts || []) impactCost += Math.abs((i.impact_m2 || 0) * (P[i.cat] || 700));
const impactPct = totCost ? +(impactCost / totCost * 100).toFixed(1) : 0;
const pass = dev <= 0.08 && dev2 <= 0.08 && impactPct <= 5;
const out = { ref: REF, target: target.label, primary_m2: primArea, remeasured_m2: verdict.remeasured_area_m2, deviation_pct: +(dev * 100).toFixed(1), target2: target2?.label || null, primary2_m2: target2?.area_m2 || null, remeasured2_m2: verdict.remeasured_area2_m2 || null, deviation2_pct: +(dev2 * 100).toFixed(1), impact_pct: impactPct, allocation_issues: verdict.allocation_issues, missing_parts: verdict.missing_parts, pass, notes: verdict.notes || "" };
writeFileSync(join(ROOT, "scripts", `verify-${REF}-${slug}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
