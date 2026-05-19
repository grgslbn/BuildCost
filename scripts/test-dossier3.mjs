import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

const EXPERT = {
  buildings: [{
    name: 'Residentie Prestige I',
    total_enclosed_sqm: 2271,
    total_terraces_sqm: 201,
    floors: [
      { level: -1, total_sqm: 280, terraces_sqm: 0 },
      { level: 0, total_sqm: 280, terraces_sqm: 0 },
      { level: 1, total_sqm: 177, terraces_sqm: 15 },
      { level: 2, total_sqm: 177, terraces_sqm: 15 },
      { level: 3, total_sqm: 177, terraces_sqm: 15 },
      { level: 4, total_sqm: 177, terraces_sqm: 15 },
      { level: 5, total_sqm: 177, terraces_sqm: 15 },
      { level: 6, total_sqm: 177, terraces_sqm: 15 },
      { level: 7, total_sqm: 177, terraces_sqm: 15 },
      { level: 8, total_sqm: 177, terraces_sqm: 15 },
      { level: 9, total_sqm: 177, terraces_sqm: 15 },
      { level: 10, total_sqm: 118, terraces_sqm: 66 },
    ]
  }]
};

const modelId = resolveModel('sonnet');
console.log(`\n=== Testing Residentie Prestige I on sonnet (${modelId}) ===\n`);

const hires = process.argv.includes('--hires');
const imgDir = hires ? 'output/test-55047-hires' : 'output/test-55047';
const ext = hires ? 'jpg' : 'png';
const images = [
  { name: 'p2', png: `${imgDir}/p2.${ext}` },
  { name: 'p3', png: `${imgDir}/p3.${ext}` },
  { name: 'p4', png: `${imgDir}/p4.${ext}` },
];
console.log(`Mode: ${hires ? 'HIRES' : 'standard'}`);

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `Residentie Prestige I, Leopoldlaan 121, Middelkerke.
Appartementsgebouw: 10 bovengrondse verdiepingen + kelder.

BUILDING STRUCTURE:
- Kelder (-1): privatieve bergingen + parkeergarage. Same footprint as GV.
- Gelijkvloers (0): handelsruimte (commercial) + gemeenschappelijke ruimte (lift, trap, inkom).
- Verdiepingen 1-9: typical floors, 2 apartments per floor + small common area (lift, trap, landing).
- Verdieping 10: 1 penthouse apartment + dakterras. Smaller footprint than typical.

CRITICAL — BUILDING SHAPE:
The residential tower (floors 1-9) is NARROWER than the kelder/GV base. Kelder and GV share the same footprint. The tower above is smaller.

PAGE GUIDE:
- p2: TALL sheet with TWO plans side by side. LEFT = gelijkvloers (ground floor). RIGHT = kelderverdieping (basement). These share the same (wider) footprint.
- p3: TWO plans on one sheet. TOP = typische verdieping (apartment floor, NARROWER tower). BOTTOM = a floor variant with dimension annotations.
- p4: TWO plans on one sheet. TOP = typische verdieping. BOTTOM = 10de verdieping (penthouse).

SCALE CALIBRATION — PER PLAN:
Each plan may be at a DIFFERENT scale. Calibrate INDEPENDENTLY for each plan on each page.
- On p2: use parking space width (2.50m) or door openings (0.80m) to calibrate.
- On p3/p4: use door openings (0.80m) to calibrate.
- DO NOT assume the same pixel-per-meter ratio across different pages.

COMMON AREAS:
- GV: entrance hall + lift + stairs + corridors = ~40 m²
- Typical floors 1-9: lift shaft + stairwell + small landing only = ~8-10 m². Much smaller than GV.`;

try {
  const result = await extractSqm(images, modelId, { apiKey: API_KEY, context, timeoutMs: 300_000 });

  console.log(`\nDone in ${(result.processingTimeMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`Cost: $${result.costUsd}`);
  console.log(`Images: ${result.imageCount} (${result.imageSizeMb} MB)\n`);

  writeFileSync('output/test-55047/result-sonnet.json', JSON.stringify(result, null, 2));

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
