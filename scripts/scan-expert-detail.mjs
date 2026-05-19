import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
const targetPage = parseInt(process.argv[3] || '6');
if (!pdfPath) { console.error('Usage: node scripts/scan-expert-detail.mjs <pdf> [page]'); process.exit(1); }

const pdfData = new Uint8Array(readFileSync(pdfPath));
const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
const page = await doc.getPage(targetPage);
const tc = await page.getTextContent();
const vp = page.getViewport({ scale: 1 });

console.log(`Page ${targetPage} — ${vp.width}×${vp.height}\n`);

// Group items by approximate Y position (rows)
const items = tc.items.map(it => ({
  str: it.str.trim(),
  x: Math.round(it.transform[4]),
  y: Math.round(it.transform[5]),
  w: Math.round(it.width),
  fontSize: Math.round(it.transform[0])
})).filter(it => it.str.length > 0);

// Sort by Y descending (PDF coords: bottom = 0), then X
items.sort((a, b) => b.y - a.y || a.x - b.x);

// Group into rows (items within 3px of Y)
const rows = [];
let currentRow = [];
let currentY = items[0]?.y;

for (const item of items) {
  if (Math.abs(item.y - currentY) > 3) {
    if (currentRow.length) rows.push({ y: currentY, items: currentRow });
    currentRow = [];
    currentY = item.y;
  }
  currentRow.push(item);
}
if (currentRow.length) rows.push({ y: currentY, items: currentRow });

// Print rows that contain relevant content
const RELEVANT = /berekening|omschrijving|opp|niveau|waarde|kelder|gelijkvloers|verdieping|terras|garage|appartement|woning|fiets|berging|lift|€|m²|\d{3,}/i;

console.log('Relevant rows (Y → items with x-positions):\n');
for (const row of rows) {
  const text = row.items.map(it => it.str).join(' ');
  if (RELEVANT.test(text)) {
    const cols = row.items.map(it => `[x${it.x}] "${it.str}"`).join('  ');
    console.log(`Y=${row.y}:  ${cols}`);
  }
}
