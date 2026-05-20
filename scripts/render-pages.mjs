import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const mupdf = await import('mupdf');
const sharp = (await import('sharp')).default;

const pdfPath = process.argv[2];
const outDir = process.argv[3];
const maxWidth = parseInt(process.argv[4] || '5500');
const pages = process.argv[5]?.split(',').map(Number) || [];

if (!pdfPath || !outDir || pages.length === 0) {
  console.error('Usage: node render-pages.mjs <pdf> <outdir> <maxWidth> <page1,page2,...>');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const doc = mupdf.Document.openDocument(readFileSync(pdfPath), 'application/pdf');

for (const pageNum of pages) {
  const page = doc.loadPage(pageNum - 1);
  const bounds = page.getBounds();
  const pageW = bounds[2] - bounds[0];
  const pageH = bounds[3] - bounds[1];
  const scale = maxWidth / pageW;
  const pixmap = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pixmap.asPNG();
  const img = await sharp(Buffer.from(png)).jpeg({ quality: 90 }).toBuffer();
  const outPath = `${outDir}/p${pageNum}.jpg`;
  writeFileSync(outPath, img);
  console.log(`p${pageNum}: ${Math.round(pageW * scale)}x${Math.round(pageH * scale)} → ${(img.length / 1024 / 1024).toFixed(2)} MB`);
}
