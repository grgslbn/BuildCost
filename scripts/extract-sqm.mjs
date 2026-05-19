import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/extract-sqm.mjs <pdf-path> [output-dir] [--pages=37-41]');
  process.exit(1);
}

const outputDir = process.argv[3]?.startsWith('--') ? join('output', basename(pdfPath, '.pdf')) : (process.argv[3] || join('output', basename(pdfPath, '.pdf')));
mkdirSync(outputDir, { recursive: true });
mkdirSync(join(outputDir, 'pages'), { recursive: true });

// Parse --pages=N-M override
const pagesArg = process.argv.find(a => a.startsWith('--pages='));
let manualPages = null;
if (pagesArg) {
  const range = pagesArg.split('=')[1];
  if (range.includes('-')) {
    const [start, end] = range.split('-').map(Number);
    manualPages = [];
    for (let i = start; i <= end; i++) manualPages.push(i);
  } else {
    manualPages = range.split(',').map(Number);
  }
}

// ── Step 1: Classify PDF pages ──────────────────────────────────────────
console.log('\n━━━ STEP 1: Page Classification ━━━');
console.log(`PDF: ${pdfPath}`);

const pdfData = new Uint8Array(readFileSync(pdfPath));
const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
const numPages = doc.numPages;
console.log(`Total pages: ${numPages}`);

if (manualPages) {
  console.log(`Manual page selection: [${manualPages.join(', ')}]`);
}

const PLAN_KEYWORDS = /grondplan|verdiep|niveau|kelder|gelijkvloers|dakenplan|bouwlaag|plattegrond|floor\s*plan|basement|level|étage|rez|sous-sol/i;
const FLOOR_LABELS = /[+-]?\d|kelder|gelijkvloers|dak|zolder|rez|sous/i;

const pageClassifications = [];

for (let i = 1; i <= numPages; i++) {
  const page = await doc.getPage(i);
  const ops = await page.getOperatorList();
  const textContent = await page.getTextContent();
  const pageText = textContent.items.map(item => item.str).join(' ');

  let vectorOps = 0;
  let textOps = 0;
  let imageOps = 0;

  const VECTOR_OPS = new Set([7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41]);
  const TEXT_OPS = new Set([42,43,44,45,46,47,48,49,50]);
  const IMAGE_OPS = new Set([82,83,84,85]);

  for (const op of ops.fnArray) {
    if (VECTOR_OPS.has(op)) vectorOps++;
    else if (TEXT_OPS.has(op)) textOps++;
    else if (IMAGE_OPS.has(op)) imageOps++;
  }

  const totalOps = vectorOps + textOps + imageOps;
  const vectorRatio = totalOps > 0 ? vectorOps / totalOps : 0;

  const hasplanKeywords = PLAN_KEYWORDS.test(pageText);
  const hasBO = /\bBO\b|bruto\s*opp/i.test(pageText);
  const hasDimensions = /\d+[,\.]\d+\s*m²|\d+[,\.]\d+\s*x\s*\d+/i.test(pageText);

  // Architectural floor plans have:
  // 1. High total operations (complex drawings) — typically 1500+
  // 2. High vector count (lines, arcs, paths)
  // 3. Often plan-related text labels
  let classification;
  let score = 0;

  if (totalOps > 3000 && vectorOps > 1500) score += 3;
  else if (totalOps > 1500 && vectorOps > 800) score += 2;
  else if (vectorOps > 500 && vectorRatio > 0.7) score += 1;

  if (hasplanKeywords) score += 2;
  if (hasBO) score += 2;
  if (hasDimensions) score += 1;

  if (score >= 3) classification = 'plan';
  else if (totalOps > 100 && imageOps / totalOps > 0.3) classification = 'photo';
  else classification = 'text';

  pageClassifications.push({
    page: i,
    classification,
    score,
    vectorOps,
    textOps,
    imageOps,
    totalOps,
    vectorRatio: Math.round(vectorRatio * 100),
    hasplanKeywords,
    hasBO,
    textPreview: pageText.substring(0, 120).replace(/\s+/g, ' ')
  });

  const marker = classification === 'plan' ? '◆' : classification === 'photo' ? '▪' : '·';
  const flags = [hasplanKeywords && 'PLAN', hasBO && 'BO', hasDimensions && 'DIM'].filter(Boolean).join(',');
  console.log(`  ${marker} Page ${String(i).padStart(2)}: ${classification.padEnd(5)} (score:${score}) | ops: ${totalOps} (v:${vectorOps} t:${textOps} i:${imageOps}) ${flags ? `[${flags}]` : ''}`);
}

// Deduplicate pages with identical op signatures
const seen = new Set();
const uniquePages = [];
for (const p of pageClassifications) {
  const sig = `${p.vectorOps}-${p.textOps}-${p.imageOps}`;
  if (seen.has(sig) && p.classification === 'plan') {
    console.log(`  ⊘ Page ${p.page} is a duplicate of an earlier page (same ops: ${sig})`);
    p.classification = 'duplicate';
  } else {
    seen.add(sig);
  }
}

const planPages = manualPages
  ? manualPages.map(n => ({ page: n }))
  : pageClassifications.filter(p => p.classification === 'plan');

console.log(`\nSelected ${planPages.length} plan pages: [${planPages.map(p => p.page).join(', ')}]`);
writeFileSync(join(outputDir, 'classification.json'), JSON.stringify(pageClassifications, null, 2));

if (planPages.length === 0) {
  console.log('\n⚠ No plan pages detected. Use --pages=N-M to specify manually.');
  process.exit(0);
}

// ── Step 2: Render plan pages with mupdf ────────────────────────────────
console.log('\n━━━ STEP 2: Rendering Plan Pages (mupdf) ━━━');

// Belgian architectural plans are often A1/A0 landscape with 2 floor plans per sheet.
// Claude Vision resizes to 1568px max — at full page width, annotations are unreadable.
// Strategy: render at high DPI, split landscape pages into L/R halves with sharp.
const sharp = (await import('sharp')).default;
const TARGET_HALF_WIDTH = 2500;

const mupdf = await import('mupdf');
const mupdfDoc = mupdf.Document.openDocument(readFileSync(pdfPath), 'application/pdf');
const renderedPages = [];

for (const { page } of planPages) {
  try {
    const mupdfPage = mupdfDoc.loadPage(page - 1);
    const bounds = mupdfPage.getBounds();
    const pageW = bounds[2] - bounds[0];
    const pageH = bounds[3] - bounds[1];
    const isLandscape = pageW > pageH * 1.3;

    // Render full page — target 5000px wide for landscape (2500 per half), 2500 for portrait
    const targetW = isLandscape ? TARGET_HALF_WIDTH * 2 : TARGET_HALF_WIDTH;
    const scale = Math.min(targetW / pageW, 300 / 72);
    const pixmap = mupdfPage.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false, true
    );
    const fullPng = Buffer.from(pixmap.asPNG());
    const fullW = pixmap.getWidth();
    const fullH = pixmap.getHeight();

    if (isLandscape) {
      const halfW = Math.floor(fullW * 0.52);
      for (const [side, left] of [['L', 0], ['R', fullW - halfW]]) {
        const outPath = join(outputDir, 'pages', `page-${String(page).padStart(2, '0')}-${side}.png`);
        const cropped = await sharp(fullPng)
          .extract({ left, top: 0, width: halfW, height: fullH })
          .png()
          .toBuffer();
        writeFileSync(outPath, cropped);
        const sizeMB = (cropped.length / 1024 / 1024).toFixed(1);
        console.log(`  Page ${String(page).padStart(2)}${side} → ${outPath} (${halfW}×${fullH}px, ${sizeMB}MB)`);
        renderedPages.push({ page, side, path: outPath, width: halfW, height: fullH });
      }
    } else {
      const outPath = join(outputDir, 'pages', `page-${String(page).padStart(2, '0')}.png`);
      writeFileSync(outPath, fullPng);
      const sizeMB = (fullPng.length / 1024 / 1024).toFixed(1);
      console.log(`  Page ${String(page).padStart(2)}  → ${outPath} (${fullW}×${fullH}px, ${sizeMB}MB)`);
      renderedPages.push({ page, path: outPath, width: fullW, height: fullH });
    }
  } catch (e) {
    console.log(`  ✗ Page ${page} render failed: ${e.message}`);
  }
}

console.log(`\nRendered ${renderedPages.length}/${planPages.length} pages`);

if (renderedPages.length === 0) {
  console.log('No pages rendered successfully.');
  process.exit(1);
}

// ── Step 3: Send to Claude Vision API ───────────────────────────────────
console.log('\n━━━ STEP 3: Claude Vision API Extraction ━━━');

const apiKey = process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.log('⚠ Set ANTHROPIC_API_KEY or BUILDCOST_ANTHROPIC_KEY to enable API extraction.');
  console.log(`  Images saved in: ${join(outputDir, 'pages')}`);
  process.exit(0);
}

const promptMd = readFileSync('prompts/sqm_extraction.md', 'utf-8').replace(/\r\n/g, '\n');
const codeBlocks = [...promptMd.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1].trim());
const systemPrompt = codeBlocks[0];
const userPrompt = codeBlocks[1];

if (!systemPrompt || !userPrompt) {
  console.error(`Failed to extract prompts (found ${codeBlocks.length} code blocks)`);
  process.exit(1);
}

const content = [{ type: 'text', text: userPrompt }];
let totalImageBytes = 0;

for (const { path, page } of renderedPages) {
  const imageData = readFileSync(path);
  totalImageBytes += imageData.length;
  content.push({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: imageData.toString('base64')
    }
  });
}

console.log(`Sending ${renderedPages.length} images (${(totalImageBytes / 1024 / 1024).toFixed(1)}MB total) to Claude Sonnet 4...`);
const startTime = Date.now();

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content }]
  })
});

if (!response.ok) {
  const err = await response.text();
  console.error(`API error ${response.status}: ${err}`);
  process.exit(1);
}

const result = await response.json();
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`Response in ${elapsed}s | tokens: ${result.usage?.input_tokens} in, ${result.usage?.output_tokens} out`);

const rawText = result.content[0].text;
writeFileSync(join(outputDir, 'raw-response.txt'), rawText);

let extraction;
try {
  const jsonStr = rawText.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
  extraction = JSON.parse(jsonStr);
  writeFileSync(join(outputDir, 'extraction.json'), JSON.stringify(extraction, null, 2));
  console.log(`\nExtraction saved to ${join(outputDir, 'extraction.json')}`);
} catch (e) {
  console.error(`JSON parse failed: ${e.message}`);
  console.log('Raw response saved to raw-response.txt');
  process.exit(1);
}

// ── Step 4: Summary + Benchmark ─────────────────────────────────────────
console.log('\n━━━ STEP 4: Results ━━━');

for (const bldg of extraction.buildings || []) {
  console.log(`\n  ${bldg.id}: ${bldg.name} (${bldg.type})`);
  for (const floor of bldg.floors || []) {
    const zones = (floor.zones || []).map(z => `${z.zone_type}:${z.area_sqm}`).join(', ');
    console.log(`    Level ${String(floor.level).padStart(2)}: ${String(floor.floor_total_sqm).padStart(6)} m² + ${floor.terraces_sqm || 0} terras | ${zones}`);
  }
  const t = bldg.building_totals || {};
  console.log(`    ─── Total: ${t.enclosed_sqm || '?'} m² enclosed, ${t.terraces_sqm || '?'} m² terras`);
}

if (extraction.extraction_warnings?.length) {
  console.log(`\n⚠ Warnings:`);
  for (const w of extraction.extraction_warnings) console.log(`  - ${w}`);
}

console.log(`\n✓ Done → ${outputDir}/`);
