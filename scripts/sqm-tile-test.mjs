/**
 * sqm-tile-test.mjs — does TILING unlock reading of printed m² labels?
 * Anthropic downsamples every image to ~1568px long edge, so small labels on a full
 * A1/A0 sheet are lost. We render each plan page large and split it into a 3×3 grid of
 * overlapping tiles (each tile ≈ native resolution → labels survive). One vision call
 * reads every printed area label across the tiles; we dedup + classify + compare to GT.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const AKEY = env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";
const DIR = "C:/Users/tieme/Desktop/testing 30_5";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TESTS = [
  { file: "25-54628700plan.pdf", ref: "25-546287", heated: 2419, strict: 1501, pages: [3, 4] },
  { file: "25-542077plan.pdf", ref: "25-542077", heated: 2009, strict: 1876, pages: [4, 5] },
];
const RENDER_DPI = 200;
const TILE_CAP = 18;

const SYS = "You read printed area labels (m²) off Belgian architect floor plans. Each image is a CROPPED TILE of a larger plan sheet (tiles overlap, so the same label may appear in two tiles — count it ONCE). Return ONLY JSON.";
const INSTR = `These images are overlapping TILES of the floor plans of ONE building. Read EVERY printed area label you can see: apartments/units ("app 0.3A 104,3 m²","B001 78,5 m²"), rooms ("leefruimte 32 m²"), common areas ("gemene delen","traphal","inkomhal"), and the totals if printed.
For each, give the label text, its level if shown, the m², and a category:
  cat1 = heated/living/finished (apartments, houses, offices, shops, COMMON circulation), cat2 = garage/parking/cellar/storage/technical, cat3 = terras/balkon/dakterras, other = non-floor.
The SAME unit may appear on multiple overlapping tiles — list each distinct unit ONCE (dedup by label text).
Belgian numbers 1.234,56→1234.56.
Return JSON: {"areas":[{"label":"...","level":"...","m2":<n>,"cat":"cat1|cat2|cat3|other"}],"printed_total_m2":<n|null>,"n_distinct_units":<int>,"confidence":<0..1>,"notes":"how legible were the labels"}`;

async function tilesFor(buf, pages) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages();
  const tiles = [];
  for (const p of pages) {
    if (p < 0 || p >= total) continue;
    let full, W, H;
    try {
      const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(RENDER_DPI / 72, RENDER_DPI / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      full = Buffer.from(pix.asPNG()); W = pix.getWidth(); H = pix.getHeight();
    } catch { continue; }
    // skip tiny/blank pages
    if (W < 800 || H < 600) continue;
    const GX = 3, GY = 3, OV = 0.08;
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const left = Math.max(0, Math.floor((gx / GX - OV) * W));
        const top = Math.max(0, Math.floor((gy / GY - OV) * H));
        const w = Math.min(W - left, Math.ceil((1 / GX + 2 * OV) * W));
        const h = Math.min(H - top, Math.ceil((1 / GY + 2 * OV) * H));
        try {
          let png = await sharp(full).extract({ left, top, width: w, height: h }).png().toBuffer();
          // keep each tile under ~1568px native so the API does not downsample away labels
          if (Math.max(w, h) > 1600) png = await sharp(png).resize({ width: w >= h ? 1568 : null, height: h > w ? 1568 : null }).png().toBuffer();
          if (png.length <= 3_400_000) tiles.push({ page: p, gx, gy, b64: png.toString("base64") });
        } catch { /* skip */ }
      }
    }
  }
  return tiles;
}
async function vision(images) {
  await sleep(1200);
  const content = [{ type: "text", text: INSTR }, ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  for (let a = 0; a < 3; a++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SYS, messages: [{ role: "user", content }] }) });
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    const j = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
    const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
  return null;
}

for (const t of TESTS) {
  try {
    const allTiles = await tilesFor(readFileSync(`${DIR}/${t.file}`), t.pages);
    // pick the most relevant tiles — cap at 14 to keep one call sane (prefer middle rows where plans sit)
    const tiles = allTiles.slice(0, TILE_CAP).map((x) => x.b64);
    process.stderr.write(`${t.ref}: ${allTiles.length} tiles, sending ${tiles.length}\n`);
    const r = await vision(tiles);
    if (!r) { process.stderr.write(`${t.ref}: geen extractie\n`); continue; }
    const areas = r.areas || [];
    const sum = (c) => areas.filter((a) => a.cat === c).reduce((s, a) => s + (+a.m2 > 0 ? +a.m2 : 0), 0);
    const cat1 = sum("cat1"), cat2 = sum("cat2"), cat3 = sum("cat3");
    const dH = ((cat1 / t.heated - 1) * 100).toFixed(0);
    const dS = ((cat1 / t.strict - 1) * 100).toFixed(0);
    process.stderr.write(`${t.ref} GT heated ${t.heated} / strict ${t.strict}  | TILED cat1=${Math.round(cat1)} (vs heated ${dH}%, vs strict ${dS}%) cat2=${Math.round(cat2)} cat3=${Math.round(cat3)} | units=${r.n_distinct_units} conf=${r.confidence} printed_total=${r.printed_total_m2 || "—"}\n`);
    process.stderr.write(`   notes: ${(r.notes || "").slice(0, 160)}\n`);
    process.stderr.write(`   labels: ` + areas.slice(0, 18).map((a) => `${a.label}=${a.m2}(${a.cat})`).join(", ") + `\n\n`);
  } catch (e) { process.stderr.write(`${t.ref}: FOUT ${String(e.message).slice(0, 150)}\n`); }
}
