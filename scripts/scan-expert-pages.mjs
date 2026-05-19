import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: node scripts/scan-expert-pages.mjs <pdf>'); process.exit(1); }

const pdfData = new Uint8Array(readFileSync(pdfPath));
const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;

const PATTERNS = [
  /berekening/i,
  /opp\/inhoud|opp\.\/inhoud/i,
  /nieuwbouwwaarde/i,
  /vetusteit/i,
  /reconstructiewaarde/i,
  /omschrijving.*niveau/i,
  /verdieping.*opp/i,
  /kelder.*m²|kelders.*m²/i,
  /gelijkvloers.*m²/i,
  /appartementen.*m²/i,
];

console.log(`Scanning ${doc.numPages} pages in ${pdfPath}\n`);

for (let i = 1; i <= doc.numPages; i++) {
  try {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map(it => it.str).join(' ');

    const matches = PATTERNS.filter(p => p.test(text));
    if (matches.length > 0) {
      console.log(`━━━ Page ${i} (${matches.length} pattern matches) ━━━`);
      console.log(`Patterns: ${matches.map(p => p.source).join(', ')}`);
      // Print relevant lines
      const lines = text.split(/\s{3,}/).filter(l => l.trim().length > 2);
      for (const line of lines.slice(0, 60)) {
        if (/berekening|opp|m²|nieuwbouw|vetusteit|kelder|gelijkvloers|verdieping|terras|garage|appartement|woning|fiets/i.test(line)) {
          console.log(`  ${line.trim().substring(0, 120)}`);
        }
      }
      console.log('');
    }
  } catch (e) {
    console.log(`  Page ${i}: error — ${e.message}`);
  }
}
