/**
 * cv-footprint.mjs — DETERMINISTIC CV footprint (no vision model).
 * Walls are THICK dark structures; dimension lines are THIN; text is small clusters.
 * 1. Render floor-plan crop grayscale.
 * 2. Blur (kills thin dimension lines, keeps thick walls) + threshold → wall mask.
 * 3. Dark-density profile per column/row → building bounding extent (walls span the
 *    building; sparse noise outside is ignored via a density threshold).
 * 4. Convert px→m via stated scale × render DPI; report footprint, compare to known.
 * Usage: node scripts/cv-footprint.mjs <pdf> <pageIdx> <scaleDenom> <cropFrac> <knownM2>
 */
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import sharp from "sharp";

const [, , PDF, PAGE, SCALE, CROP, KNOWN] = process.argv;
const pageIdx = parseInt(PAGE, 10), scaleDenom = parseInt(SCALE || "50", 10);
const cropFrac = CROP ? CROP.split("-").map(Number) : [0, 1];
const DPI = 150, renderScale = DPI / 72;
const pxPerM = (100 / scaleDenom) * (72 / 2.54) * renderScale;

const buf = readFileSync(PDF);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const pix = doc.loadPage(pageIdx).toPixmap(mupdf.Matrix.scale(renderScale, renderScale), mupdf.ColorSpace.DeviceRGB, false, true);
const full = Buffer.from(pix.asPNG()); const W = pix.getWidth(), Hh = pix.getHeight();
const left = Math.floor(W * cropFrac[0]), cw = Math.floor(W * (cropFrac[1] - cropFrac[0]));

// grayscale, blur (remove thin lines), get raw pixels
const img = sharp(full).extract({ left, top: 0, width: cw, height: Hh }).grayscale().blur(2.5);
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height;
const DARK = 110; // threshold after blur

// column + row dark-density
const colDark = new Array(w).fill(0), rowDark = new Array(h).fill(0);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (data[y * w + x] < DARK) { colDark[x]++; rowDark[y]++; }
}
// adaptive threshold: a column/row is "building" if its dark-count exceeds a
// fraction of the MAX dark-count in that profile (robust to building width/orientation).
const maxCol = Math.max(...colDark), maxRow = Math.max(...rowDark);
const colThr = maxCol * 0.18, rowThr = maxRow * 0.18;
const firstIdx = (arr, thr) => arr.findIndex((v) => v >= thr);
const lastIdx = (arr, thr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= thr) return i; return -1; };
const L = firstIdx(colDark, colThr), R = lastIdx(colDark, colThr);
const T = firstIdx(rowDark, rowThr), B = lastIdx(rowDark, rowThr);
console.log(`maxCol ${maxCol} maxRow ${maxRow} | colThr ${colThr.toFixed(0)} rowThr ${rowThr.toFixed(0)}`);

const widthM = (R - L) / pxPerM, depthM = (B - T) / pxPerM;
const footprint = widthM * depthM;
console.log(`px/m ${pxPerM.toFixed(1)} | bbox L${L} R${R} T${T} B${B} (${R-L}×${B-T}px)`);
console.log(`→ ${widthM.toFixed(1)}m × ${depthM.toFixed(1)}m = ${footprint.toFixed(0)} m²`);
if (KNOWN) console.log(`expert ${KNOWN} m²  →  Δ ${((footprint / +KNOWN - 1) * 100).toFixed(0)}%`);
