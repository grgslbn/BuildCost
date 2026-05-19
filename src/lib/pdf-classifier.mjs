import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const PLAN_KEYWORDS = [
  /grondplan/i, /gelijkvloers/i, /verdieping/i, /kelder/i,
  /slaapkamer/i, /badkamer/i, /keuken/i, /woonkamer/i, /leefruimte/i,
  /berging/i, /garage/i, /inkomhal/i, /trappenhal/i,
  /\bBO\s+[\d,\.]+/i, /\bNO\s+[\d,\.]+/i,
  /schaal\s*1\s*[:/]\s*\d+/i, /1\/\d+/,
];

const PLAN_STRONG = [
  /grondplan\s*[+\-]?\s*\d+/i,
  /plan\s+(gelijkvloers|verdieping|kelder)/i,
  /\bBO\s+[\d,\.]+\s*m/i,
];

const SECTION_KEYWORDS = [
  /doorsnede/i, /snede/i, /coupe/i, /section/i,
  /gevelaanzicht/i, /gevelbekleding/i, /facade/i,
];

const ADMIN_KEYWORDS = [
  /aanbieder/i, /verzekeringsaanvraag/i, /polishouder/i,
  /dossiernummer/i, /inspectiedatum/i,
  /digitale handtekening/i, /ondertekend/i,
  /foto\s*\d+/i,
  /@[\w.-]+\.\w+/,
  /van:\s*\w+/i, /aan:\s*\w+/i,
];

const DRAINAGE_KEYWORDS = [
  /funderings.*plan/i, /rioleringsplan/i, /drainage/i,
  /septische put/i, /hemelwater/i, /regenwaterput/i,
];

export async function classifyPages(pdfPath) {
  const pdfData = new Uint8Array(readFileSync(pdfPath));
  const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
  const pages = [];

  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();

      const items = tc.items.map(it => ({
        str: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5])
      })).filter(it => it.str.length > 0);

      const text = items.map(it => it.str).join(' ');
      const textLen = text.length;
      const isLandscape = viewport.width > viewport.height * 1.2;

      const planHits = PLAN_KEYWORDS.filter(p => p.test(text)).length;
      const strongHits = PLAN_STRONG.filter(p => p.test(text)).length;
      const sectionHits = SECTION_KEYWORDS.filter(p => p.test(text)).length;
      const adminHits = ADMIN_KEYWORDS.filter(p => p.test(text)).length;
      const drainageHits = DRAINAGE_KEYWORDS.filter(p => p.test(text)).length;

      let type = 'unknown';
      let confidence = 0;

      if (strongHits >= 1 || (planHits >= 3 && adminHits < 2)) {
        type = 'floor_plan';
        confidence = Math.min(0.95, 0.5 + strongHits * 0.2 + planHits * 0.05);
      } else if (drainageHits >= 2) {
        type = 'drainage_plan';
        confidence = 0.8;
      } else if (sectionHits >= 1 && planHits < 3) {
        type = 'section_elevation';
        confidence = 0.7;
      } else if (adminHits >= 2) {
        type = 'admin';
        confidence = 0.8;
      } else if (textLen < 50 && !isLandscape) {
        type = 'photo_or_blank';
        confidence = 0.5;
      } else if (planHits >= 2) {
        type = 'floor_plan';
        confidence = 0.4 + planHits * 0.05;
      }

      // Detect multi-plan landscape pages (e.g., 3 floor plans on one sheet)
      const grondplanLabels = text.match(/grondplan\s*[+\-]?\s*\d+/gi) || [];
      const planLabels = text.match(/plan\s+(gelijkvloers|verdieping|kelder)/gi) || [];
      const floorLabelsOnPage = [...grondplanLabels, ...planLabels];

      pages.push({
        pageNum: i,
        type,
        confidence,
        isLandscape,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        textLength: textLen,
        floorLabels: floorLabelsOnPage,
        multiPlan: floorLabelsOnPage.length >= 2,
        scores: { plan: planHits, strong: strongHits, section: sectionHits, admin: adminHits, drainage: drainageHits }
      });
    } catch (e) {
      pages.push({
        pageNum: i, type: 'error', confidence: 0,
        error: e.message
      });
    }
  }

  return { doc, pages, totalPages: doc.numPages };
}

// CLI mode
if (process.argv[1]?.includes('pdf-classifier')) {
  const pdfPath = process.argv[2];
  if (!pdfPath) { console.error('Usage: node src/lib/pdf-classifier.mjs <pdf>'); process.exit(1); }

  const { pages, totalPages } = await classifyPages(pdfPath);
  console.log(`${totalPages} pages:\n`);

  const typeColors = { floor_plan: '🟢', section_elevation: '🟡', drainage_plan: '🔵', admin: '⚪', photo_or_blank: '⬜', unknown: '❓', error: '🔴' };

  for (const p of pages) {
    const icon = typeColors[p.type] || '❓';
    const dims = `${p.width}×${p.height}${p.isLandscape ? ' L' : ''}`;
    const labels = p.floorLabels?.length ? ` [${p.floorLabels.join(', ')}]` : '';
    console.log(`  ${icon} Page ${String(p.pageNum).padStart(2)}: ${p.type.padEnd(18)} (${(p.confidence * 100).toFixed(0)}%) ${dims}${labels}`);
  }

  const planPages = pages.filter(p => p.type === 'floor_plan');
  console.log(`\n${planPages.length} floor plan page(s) identified`);
}
