/**
 * sqm-pixel-test.mjs — DETERMINISTIC pixel measurement.
 * Belgian architect plans are drawn to scale (1:50) on a true-size sheet, so
 * pixels↔meters is computable from (stated scale × render DPI) WITHOUT the model
 * interpreting dimension chains. The model only needs to point at the building's
 * outer bounding box (left/right/top/bottom px) — a task vision is good at.
 *
 * Verify on a floor with a known expert footprint.
 * Usage: node scripts/sqm-pixel-test.mjs <pdf> <pageIdx> <scaleDenom> <cropFrac> <knownM2>
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
const [, , PDF, PAGE, SCALE, CROP, KNOWN] = process.argv;
const pageIdx = parseInt(PAGE, 10);
const scaleDenom = parseInt(SCALE || "50", 10);
const cropFrac = CROP ? CROP.split("-").map(Number) : [0, 1]; // e.g. "0-0.36"

const DPI = 150;
const renderScale = DPI / 72;
// 1 m real = (100cm / scaleDenom) cm paper = (100/scaleDenom) cm × (72/2.54) pt/cm × renderScale px/pt
const pxPerM = (100 / scaleDenom) * (72 / 2.54) * renderScale;

const buf = readFileSync(PDF);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const pix = doc.loadPage(pageIdx).toPixmap(mupdf.Matrix.scale(renderScale, renderScale), mupdf.ColorSpace.DeviceRGB, false, true);
const full = Buffer.from(pix.asPNG()); const W = pix.getWidth(), Hh = pix.getHeight();
const left = Math.floor(W * cropFrac[0]), w = Math.floor(W * (cropFrac[1] - cropFrac[0]));
let crop = await sharp(full).extract({ left, top: 0, width: w, height: Hh }).png().toBuffer();
let cw = w;
while (crop.length > 3_600_000 && cw > 1500) { cw = Math.floor(cw * 0.82); crop = await sharp(full).extract({ left, top: 0, width: w, height: Hh }).resize({ width: cw }).png().toBuffer(); }
const scaleFactor = cw / w; // if resized, px coords scale down
const effPxPerM = pxPerM * scaleFactor;
console.log(`render ${DPI}dpi, scale 1:${scaleDenom} → ${pxPerM.toFixed(1)} px/m (crop ${cw}px → eff ${effPxPerM.toFixed(1)} px/m)`);

const INSTR = `This image is ONE floor plan of a building. Identify the OUTER WALL bounding box of the BUILDING ENVELOPE (the heated/enclosed structure — the outer face of the exterior walls). IGNORE: dimension lines, text/labels outside the walls, the property boundary (dashed lines), terraces projecting outside the walls, the title block, and the scale bar.
Return ONLY JSON with pixel coordinates (origin top-left) of the building's outer envelope:
{"left_px":<x of leftmost outer wall>,"right_px":<x of rightmost outer wall>,"top_px":<y of topmost outer wall>,"bottom_px":<y of bottommost outer wall>,"shape":"rectangle|L-shape|irregular","note":"..."}`;

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, messages: [{ role: "user", content: [{ type: "text", text: INSTR }, { type: "image", source: { type: "base64", media_type: "image/png", data: crop.toString("base64") } }] }] }),
});
const j = await res.json();
const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
const box = m ? JSON.parse(m[0]) : null;
if (!box) { console.log("geen box:", (j.content?.[0]?.text || JSON.stringify(j)).slice(0, 300)); process.exit(1); }
const widthM = (box.right_px - box.left_px) / effPxPerM;
const depthM = (box.bottom_px - box.top_px) / effPxPerM;
const footprint = widthM * depthM;
console.log(`box px: L${box.left_px} R${box.right_px} T${box.top_px} B${box.bottom_px} (${box.shape})`);
console.log(`→ ${widthM.toFixed(1)}m × ${depthM.toFixed(1)}m = ${footprint.toFixed(0)} m²`);
if (KNOWN) console.log(`expert footprint ${KNOWN} m²  →  Δ ${((footprint / +KNOWN - 1) * 100).toFixed(0)}%`);
