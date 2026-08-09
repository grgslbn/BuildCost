/**
 * classify-scanned.mjs — vision-subclassificatie van de 'scanned_or_photos' bucket.
 * Per dossier: render miniaturen van de beeldpagina's (geen tekstlaag) en vraag het model
 * of er een echt architecturaal grondplan tussen zit (vs foto's/kadaster/gevels-only).
 * Output: scripts/scanned-class.json
 *
 * Usage: node scripts/classify-scanned.mjs [sampleN=50]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
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
const DIRS = ["C:/Users/tieme/Mijn Drive/M²Value/field/ALL"];
const N = parseInt(process.argv[2] || "50", 10);
const OUT = join(ROOT, "scripts", "scanned-class.json");
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const inv = readFileSync(join(ROOT, "scripts", "inventory.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const cands = inv.filter((r) => !r.error && r.planClass === "scanned_or_photos" && r.hasTable && r.ref && !out[r.ref]);
// deterministic spread over the list
const step = Math.max(1, Math.floor(cands.length / N));
const sample = cands.filter((_, i) => i % step === 0).slice(0, N);
console.log(`${sample.length} dossiers uit ${cands.length} kandidaten`);

const TABLE_RE = /Berekening|Nieuwbouwwaarde|Opp\/inhoud|oppervlaktestaat|meetstaat|Oppervlakte\s+incl|Surf\/contenu/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const rec of sample) {
  const digits = rec.ref.replace("-", "");
  let pdf = null;
  for (const d of DIRS) { const hit = readdirSync(d).find((f) => f.replace("-", "").startsWith(digits)); if (hit) { pdf = join(d, hit); break; } }
  if (!pdf) continue;
  try {
    const doc = mupdf.Document.openDocument(readFileSync(pdf), "application/pdf");
    const nP = doc.countPages();
    // candidate pages: the image pages recorded... inventory didn't store them; re-derive cheaply via structured text
    const imgs = [];
    const pick = [];
    for (let i = 0; i < nP && pick.length < 8; i++) {
      const st = doc.loadPage(i).toStructuredText().asText().replace(/\s/g, "");
      if (st.length < 60) pick.push(i);
    }
    for (const i of pick) {
      const page = doc.loadPage(i);
      const pix = page.toPixmap(mupdf.Matrix.scale(0.5, 0.5), mupdf.ColorSpace.DeviceRGB, false, true);
      const jpg = await sharp(Buffer.from(pix.asPNG())).resize({ width: 420, fit: "inside" }).jpeg({ quality: 60 }).toBuffer();
      imgs.push({ i, jpg });
    }
    if (!imgs.length) { out[rec.ref] = { cls: "no_image_pages" }; continue; }
    const content = [
      { type: "text", text: `Miniaturen van ${imgs.length} beeldpagina's uit een Belgisch verzekeringsdossier (pagina's ${imgs.map((x) => x.i).join(",")}). Classificeer wat er aanwezig is. Return ONLY JSON: {"has_floorplan":bool, "floorplan_pages":[ints], "has_dimensions_visible":bool, "content_types":["photo"|"cadastral_map"|"floorplan"|"elevation"|"section"|"document_scan"|"other"...]}` },
    ];
    for (const x of imgs) { content.push({ type: "text", text: `p${x.i}:` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: x.jpg.toString("base64") } }); }
    let j = null;
    for (let a = 0; a < 4; a++) {
      try {
        const msg = await client.messages.create({ model: "claude-opus-5", max_tokens: 1200, messages: [{ role: "user", content }] });
        const m = (msg.content.find((b) => b.type === "text")?.text || "").match(/\{[\s\S]*\}/);
        j = m ? JSON.parse(m[0]) : null; break;
      } catch (e) { if (e?.status === 429 || e?.status >= 500) { await sleep(6000 * (a + 1)); continue; } throw e; }
    }
    out[rec.ref] = j || { cls: "parse_fail" };
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    console.log(rec.ref, JSON.stringify(j).slice(0, 140));
    await sleep(800);
  } catch (e) { console.log(rec.ref, "FOUT", String(e.message || e).slice(0, 100)); }
}
const vals = Object.values(out).filter((v) => v.has_floorplan !== undefined);
console.log(`\n=== ${vals.length} geclassificeerd: met grondplan ${vals.filter((v) => v.has_floorplan).length}, met leesbare maten ${vals.filter((v) => v.has_dimensions_visible).length}`);
