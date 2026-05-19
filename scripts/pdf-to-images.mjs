import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createCanvas } from 'canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
const outputDir = process.argv[3] || './pdf-pages';
const startPage = parseInt(process.argv[4] || '1');
const endPage = parseInt(process.argv[5] || '999');
const scale = parseFloat(process.argv[6] || '2.0');

mkdirSync(outputDir, { recursive: true });

const data = new Uint8Array(readFileSync(pdfPath));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
const numPages = doc.numPages;
console.log(`PDF has ${numPages} pages`);

const lastPage = Math.min(endPage, numPages);
for (let i = startPage; i <= lastPage; i++) {
  try {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const outPath = join(outputDir, `page-${String(i).padStart(2, '0')}.png`);
    writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`Page ${i}/${lastPage} -> ${outPath} (${viewport.width}x${viewport.height})`);
  } catch (e) {
    console.log(`Page ${i}/${lastPage} FAILED: ${e.message}`);
  }
}

console.log('Done');
