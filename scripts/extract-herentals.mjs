import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const pdfPath = process.env.PDF_PATH || process.argv[2];
const outputDir = 'output/herentals-v3c';
mkdirSync(join(outputDir, 'pages'), { recursive: true });

const sharp = (await import('sharp')).default;
const mupdf = await import('mupdf');

const pdfData = readFileSync(pdfPath);
const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');

async function renderAndCrop(pageNum, crops) {
  const page = doc.loadPage(pageNum - 1);
  const bounds = page.getBounds();
  const pageW = bounds[2] - bounds[0];
  const pageH = bounds[3] - bounds[1];

  const scale = Math.min(5000 / pageW, 300 / 72);
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false, true
  );
  const fullPng = Buffer.from(pixmap.asPNG());
  const fullW = pixmap.getWidth();
  const fullH = pixmap.getHeight();
  console.log(`Page ${pageNum}: ${fullW}×${fullH}px`);

  const results = [];
  for (const { name, left, top, width, height } of crops) {
    const l = Math.round(left * fullW);
    const t = Math.round(top * fullH);
    const w = Math.min(Math.round(width * fullW), fullW - l);
    const h = Math.min(Math.round(height * fullH), fullH - t);

    const outPath = join(outputDir, 'pages', `${name}.png`);
    const cropped = await sharp(fullPng)
      .extract({ left: l, top: t, width: w, height: h })
      .png()
      .toBuffer();
    writeFileSync(outPath, cropped);
    console.log(`  ${name}: ${w}×${h}px (${(cropped.length / 1024).toFixed(0)}KB)`);
    results.push({ name, path: outPath, data: cropped });
  }
  return results;
}

// Page 18: landscape sheet with 3 floor plans
// Top-left: GV, Bottom-left: V+1, Top-right: V+2
console.log('\n━━━ Rendering floor plans from page 18 ━━━');
const floorPlans = await renderAndCrop(18, [
  { name: 'p18-gelijkvloers',  left: 0,    top: 0,   width: 0.52, height: 0.50 },
  { name: 'p18-verdieping-1',  left: 0,    top: 0.50, width: 0.52, height: 0.50 },
  { name: 'p18-verdieping-2',  left: 0.48, top: 0,   width: 0.52, height: 0.55 },
]);

// Page 22: kelder plan
console.log('\n━━━ Rendering kelder plan from page 22 ━━━');
const kelderPlan = await renderAndCrop(22, [
  { name: 'p22-kelder', left: 0, top: 0, width: 0.75, height: 1.0 },
]);

const allImages = [...floorPlans, ...kelderPlan];

// ── Claude API call ──
console.log('\n━━━ Claude Vision API ━━━');
const apiKey = process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('No API key'); process.exit(1); }

const systemPrompt = readFileSync('prompts/sqm_extraction.md', 'utf-8')
  .replace(/\r\n/g, '\n');
const codeBlocks = [...systemPrompt.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1].trim());

const content = [];

content.push({ type: 'text', text: `IMPORTANT CONTEXT about these images:

This is a SINGLE project in Herentals containing TWO buildings:
- Building A: "Meergezinswoning" (apartment block, 10 units) with kelder, gelijkvloers (GV), verdieping +1, verdieping +2
- Building B: "Drie geschakelde woningen" (3 attached row houses) with gelijkvloers (GV) and verdieping +1 only

The architect is Inarto Architecten, scale 1:50.

IMAGE LABELS:
1. "p18-gelijkvloers" — Ground floor plan showing BOTH buildings side by side
2. "p18-verdieping-1" — Floor +1 plan showing BOTH buildings side by side
3. "p18-verdieping-2" — Floor +2 plan showing ONLY the apartment block (row houses don't have V+2)
4. "p22-kelder" — Basement/kelder plan showing the underground parking garage, bergingen, inrit (access ramp), and technical rooms

Each floor plan image shows the ENTIRE project at that level. The apartment block is the larger L-shaped building. The 3 row houses are the smaller units attached to one side.

Measure the FULL kelder footprint including parking lanes, inrit, bergingen, and all circulation space.

${codeBlocks[1]}` });

let totalBytes = 0;
for (const img of allImages) {
  const imageData = readFileSync(img.path);
  totalBytes += imageData.length;
  content.push({ type: 'text', text: `\n--- Image: ${img.name} ---` });
  content.push({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: imageData.toString('base64')
    }
  });
}

console.log(`Sending ${allImages.length} images (${(totalBytes / 1024 / 1024).toFixed(1)}MB) to Claude Sonnet 4...`);
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
    system: codeBlocks[0],
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

// ── Benchmark comparison ──
console.log('\n━━━ Benchmark Comparison ━━━');
const benchmark = {
  'Building A (Meergezinswoning)': {
    'kelder (-1)': 747, 'appartementen GV': 436, 'appartementen V1': 357,
    'terrassen V1': 83, 'appartementen V2': 316, 'terrassen V2': 48,
    total_enclosed: 1856, total_terraces: 131, grand_total: 1987
  },
  'Building B (3 woningen)': {
    'gelijkvloers': 234, 'verdieping': 220, 'fietsenstalling': 17,
    total_enclosed: 454, total_terraces: 0, grand_total: 454
  }
};

console.log('\nExpert benchmark:');
for (const [bName, data] of Object.entries(benchmark)) {
  console.log(`  ${bName}:`);
  for (const [k, v] of Object.entries(data)) {
    console.log(`    ${k}: ${v} m²`);
  }
}

console.log('\nExtracted:');
for (const bldg of extraction.buildings || []) {
  console.log(`  ${bldg.id}: ${bldg.name} (${bldg.type})`);
  for (const floor of bldg.floors || []) {
    const zones = (floor.zones || []).map(z => `${z.zone_type}:${z.area_sqm}`).join(', ');
    console.log(`    Level ${String(floor.level).padStart(2)}: ${String(floor.floor_total_sqm).padStart(6)} m² + ${floor.terraces_sqm || 0} terras | ${zones}`);
  }
  const t = bldg.building_totals || {};
  console.log(`    ─── Total: ${t.enclosed_sqm} m² enclosed, ${t.terraces_sqm} m² terras`);
}

console.log(`\nProject total: ${extraction.project_totals?.total_enclosed_sqm} m² (expert: ${1987 + 454} = 2441 m²)`);
