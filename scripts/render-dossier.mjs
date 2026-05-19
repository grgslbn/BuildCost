import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const mupdf = await import('mupdf');
const sharp = (await import('sharp')).default;

const pdfPath = process.argv[2];
const outDir = process.argv[3] || 'output/rendered';

if (!pdfPath) {
  console.error('Usage: node render-dossier.mjs <pdf-path> [output-dir]');
  process.exit(1);
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const pdfData = readFileSync(pdfPath);
const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');
const pageCount = doc.countPages();

console.log(`PDF: ${pdfPath}`);
console.log(`Pages: ${pageCount}\n`);

for (let i = 0; i < pageCount; i++) {
  const page = doc.loadPage(i);
  const bounds = page.getBounds();
  const pageW = bounds[2] - bounds[0];
  const pageH = bounds[3] - bounds[1];
  const mmW = (pageW / 72 * 25.4).toFixed(0);
  const mmH = (pageH / 72 * 25.4).toFixed(0);
  const landscape = pageW > pageH;

  const maxWidth = 1800;
  const scale = Math.min(maxWidth / pageW, 300 / 72);
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false, true
  );
  let png = Buffer.from(pixmap.asPNG());
  const pxW = pixmap.getWidth();
  const pxH = pixmap.getHeight();

  // Compress if > 4MB
  if (png.length > 4_000_000) {
    png = await sharp(png).resize({ width: Math.round(pxW * 0.7) }).png({ quality: 80 }).toBuffer();
  }

  const outPath = `${outDir}/p${i + 1}.png`;
  writeFileSync(outPath, png);

  const sizeMB = (png.length / 1_000_000).toFixed(1);
  console.log(`  p${String(i + 1).padStart(2)}: ${pxW}×${pxH}  ${mmW}×${mmH}mm  ${landscape ? 'L' : 'P'}  ${sizeMB}MB`);
}

console.log(`\nDone. ${pageCount} pages rendered to ${outDir}/`);
