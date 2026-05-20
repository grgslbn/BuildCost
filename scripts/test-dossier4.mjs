import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Expert breakdown for Residentie Anna Monica (dossier 55079)
// Raw expert lines:
//   [-1] parkeergarage, bergingen, garages, parkeerplaatsen: 525 m²
//   [1-4] appartementen: 1151.13 m² (expert uses 1-based: 1=GV, 2=V1, 3=V2, 4=V3)
//   [0-3] gemeenschappelijke ruimtes: 137 m² (across 4 floors)
//   [0] autoliftschacht: 29 m²
//   [0] terrassen: 35 m² → BALKONS
//   [0] stadstuinen met terras: 80 m² → BALKONS
//   [1-2] balcons: 108 m² → BALKONS
//   [2-3] daktarras: 258 m² → BALKONS
// Total enclosed: 1842 m², balkons/outdoor: 481 m²
//
// Per-floor split is ESTIMATED (expert only gives category totals across floor ranges).
// 10 apartments: 3 on GV, 3 on V1, 3 on V2, 1 penthouse on V3.
// Average apartment ~115 m² (1151.13/10). Common ~34/floor. Autolift (29) on GV only.
// Balkons: terrassen(35)+stadstuinen(80) on GV=115, balcons(108) on V1-V2=54/each,
// dakterras(258) on V2-V3: ~28 on V2 (extension roof), ~230 on V3 (main roof of V2).
const EXPERT = {
  buildings: [{
    name: 'Residentie Anna Monica',
    total_enclosed_sqm: 1842,
    total_terraces_sqm: 481,
    floors: [
      { level: -1, total_sqm: 525, terraces_sqm: 0 },
      { level: 0, total_sqm: 408, terraces_sqm: 115 },
      { level: 1, total_sqm: 379, terraces_sqm: 54 },
      { level: 2, total_sqm: 379, terraces_sqm: 82 },
      { level: 3, total_sqm: 151, terraces_sqm: 230 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing Villa Anna Monica De Haan (55079) on ${modelName} (${modelId}) ===\n`);

// VerzamelPDF landscape pages p36-p41 are the architect's A3 floor plans (schaal 1/50).
// Pages 1-35 are A4 CED report/admin pages (NOT floor plans).
const images = [
  { name: 'p38 Kelder (-1) schaal 1/50',        png: 'output/test-55079-hires/p38.jpg' },
  { name: 'p40 Gelijkvloers (0) schaal 1/50',   png: 'output/test-55079-hires/p40.jpg' },
  { name: 'p39 Verdieping +1 schaal 1/50',      png: 'output/test-55079-hires/p39.jpg' },
  { name: 'p37 Verdieping +2 schaal 1/50',      png: 'output/test-55079-hires/p37.jpg' },
  { name: 'p36 Verdieping +3 schaal 1/50',      png: 'output/test-55079-hires/p36.jpg' },
  { name: 'p41 Doorsnede AB (cross-section)',    png: 'output/test-55079-hires/p41.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `Villa Anna Monica De Haan, Monicastraat 13 / nieuwstraat 15, De Haan 8420.
Nieuwbouw meergezinswoning: 10 appartementen, volledig onderkelderd.

BUILDING STRUCTURE:
- Kelder (-1): parking garage + storage (bergingen). Full footprint under entire building.
- Gelijkvloers (0): apartments + entrance + common areas + outdoor terrassen/stadstuinen.
- Verdieping 1: apartments + common areas. Balkons on some apartments.
- Verdieping 2: apartments + common areas. Balkons + dakterrassen.
- Verdieping 3: top floor, STEPPED BACK — smaller enclosed footprint. Large dakterrassen.

CRITICAL — BUILDING SHAPE:
This building is NOT rectangular. It sits on a triangular/angular plot. The floor plan has an ANGULAR shape — one or more walls follow the diagonal plot boundary.
You MUST decompose into sub-shapes. Do NOT approximate as a simple rectangle.
Measure each sub-shape carefully. An angular extension is NOT a full square — if it has a diagonal wall, use the trapezoid formula: (side1 + side2) ÷ 2 × height.

OUTDOOR SPACES:
The ground floor has terrassen (35 m² approx) and stadstuinen met terras (80 m² approx) OUTSIDE the building walls. These should be counted as balkons_sqm, NOT enclosed.
Upper floors have balkons (projecting) and dakterrassen (on the roof of the floor below).
MEASURE ALL outdoor spaces carefully — they total a significant area.

ALL PLANS ARE SCALE 1:50 — use dimension annotations on each plan for calibration.

PAGE GUIDE:
- Image 1: Kelder (basement) — parking + bergingen — measure the full underground slab
- Image 2: Gelijkvloers (ground floor) — apartments + entrance + outdoor spaces
- Image 3: Verdieping 1 — apartments + balkons
- Image 4: Verdieping 2 — apartments + balkons + dakterrassen
- Image 5: Verdieping 3 — top floor (SMALLER footprint, stepped back) + large dakterrassen
- Image 6: Snede AB (cross-section) — shows all floor levels

IMPORTANT: Measure each floor INDEPENDENTLY from its own plan. Do NOT copy the kelder area to above-ground floors — the enclosed area may differ per floor.`;

const useThinking = process.argv.includes('--think');
console.log(`Mode: HIRES, thinking: ${useThinking ? 'ON' : 'off'}`);

// Also need to update sqm-extractor to handle .jpg media type
try {
  const result = await extractSqm(images, modelId, {
    apiKey: API_KEY,
    context,
    timeoutMs: 600_000,
    thinking: useThinking,
    thinkingBudget: 15000
  });

  console.log(`\nDone in ${(result.processingTimeMs / 1000).toFixed(1)}s`);
  console.log(`Thinking: ${result.thinkingEnabled ? 'ON' : 'off'} (${result.thinkingText?.length || 0} chars)`);
  console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`Cost: $${result.costUsd}`);
  console.log(`Images: ${result.imageCount} (${result.imageSizeMb} MB)\n`);

  writeFileSync(`output/test-55079-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));
  if (result.thinkingText) {
    writeFileSync(`output/test-55079/thinking-${modelName}.txt`, result.thinkingText);
  }

  if (result.extraction) {
    const totals = result.extraction.project_totals || {};
    console.log(`AI total enclosed: ${totals.total_enclosed_sqm || 'N/A'} m²`);
    console.log(`AI total balkons: ${totals.total_balkons_sqm ?? totals.total_terraces_sqm ?? 'N/A'} m²`);
    console.log(`AI buildings: ${result.extraction.buildings?.length || 0}`);

    if (result.extraction.buildings) {
      for (const b of result.extraction.buildings) {
        console.log(`\n  ${b.name} (${b.type}):`);
        for (const f of b.floors || []) {
          const balkons = f.balkons_sqm ?? f.terraces_sqm ?? 0;
          console.log(`    Level ${f.level}: ${f.floor_total_sqm} m² enclosed, ${balkons} m² balkons — ${f.measurement || ''}`);
          if (f.contents) console.log(`      Contents: ${f.contents}`);
        }
        const bt = b.building_totals || {};
        console.log(`    TOTAL: ${bt.enclosed_sqm} enclosed, ${bt.balkons_sqm ?? bt.terraces_sqm ?? 0} balkons`);
      }
    }

    const comparison = compareExtraction(result.extraction, EXPERT);
    console.log(`\n--- Comparison vs Expert ---`);
    console.log(formatComparison(comparison));

    if (result.extraction.extraction_warnings?.length) {
      console.log('\nWarnings:');
      result.extraction.extraction_warnings.forEach(w => console.log('  -', w));
    }
  } else {
    console.log('PARSE FAILED — raw response:');
    console.log(result.rawText.slice(0, 500));
  }
} catch (err) {
  console.error('Error:', err.message);
}
