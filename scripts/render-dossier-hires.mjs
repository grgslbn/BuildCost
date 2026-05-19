import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const mupdf = await import('mupdf');
const sharp = (await import('sharp')).default;

const pdfPath = process.argv[2];
const outDir = process.argv[3] || 'output/rendered-hires';
const maxWidth = parseInt(process.argv[4] || '3500', 10);

if (!pdfPath) {
  console.error('Usage: node render-dossier-hires.mjs <pdf-path> [output-dir] [maxWidth]');
  process.exit(1);
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const pdfData = readFileSync(pdfPath);
const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');
const pageCount = doc.countPages();

console.log(`PDF: ${pdfPath}`);
console.log(`Pages: ${pageCount}`);
console.log(`Target maxWidth: ${maxWidth}px\n`);

for (let i = 0; i < pageCount; i++) {
  const page = doc.loadPage(i);
  const bounds = page.getBounds();
  const pageW = bounds[2] - bounds[0];
  const pageH = bounds[3] - bounds[1];
  const mmW = (pageW / 72 * 25.4).toFixed(0);
  const mmH = (pageH / 72 * 25.4).toFixed(0);
  const landscape = pageW > pageH;

  const scale = Math.min(maxWidth / pageW, 600 / 72);
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false, true
  );
  let png = Buffer.from(pixmap.asPNG());
  const pxW = pixmap.getWidth();
  const pxH = pixmap.getHeight();

  // Convert to JPEG with good quality for size efficiency
  const jpg = await sharp(png).jpeg({ quality: 85 }).toBuffer();

  const outPath = `${outDir}/p${i + 1}.jpg`;
  writeFileSync(outPath, jpg);

  const sizeMB = (jpg.length / 1_000_000).toFixed(2);
  console.log(`  p${String(i + 1).padStart(2)}: ${pxW}×${pxH}  ${mmW}×${mmH}mm  ${landscape ? 'L' : 'P'}  ${sizeMB}MB`);
}

console.log(`\nDone. ${pageCount} pages rendered to ${outDir}/`);
