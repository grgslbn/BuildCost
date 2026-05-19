import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Expert breakdown for Residentie MURANO (corrected: balcons → terraces)
// Raw expert lines:
//   [-1] parkeergarage: 1016 m²
//   [0]  winkelruimte (casco): 963 m²
//   [0]  gemeenschappelijk: 54 m²
//   [1-6] appartementen: 1698 m² (= 283/floor)
//   [1-5] gemeenschappelijk: 90 m² (= 18/floor)
//   [2-5] balcons: 198 m² (= 49.5/floor) → TERRACES
//   [1]  dakterrassen: 40 m² → TERRACES
// Total enclosed: 3821 m², terraces: 238 m²
const EXPERT = {
  buildings: [{
    name: 'Residentie MURANO',
    total_enclosed_sqm: 3821,
    total_terraces_sqm: 238,
    floors: [
      { level: -1, total_sqm: 1016, terraces_sqm: 0 },
      { level: 0, total_sqm: 1017, terraces_sqm: 0 },
      { level: 1, total_sqm: 301, terraces_sqm: 40 },
      { level: 2, total_sqm: 301, terraces_sqm: 49.5 },
      { level: 3, total_sqm: 301, terraces_sqm: 49.5 },
      { level: 4, total_sqm: 301, terraces_sqm: 49.5 },
      { level: 5, total_sqm: 301, terraces_sqm: 49.5 },
      { level: 6, total_sqm: 283, terraces_sqm: 0 },
    ]
  }]
};

const PLAN_PAGES = [6, 7, 8, 9, 10, 11, 12, 13];

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing dossier 25-54756 on ${modelName} (${modelId}) ===\n`);

const hires = process.argv.includes('--hires');
const imgDir = hires ? 'output/test-54756-hires' : 'output/test-54756';
const images = PLAN_PAGES.map(p => ({
  name: `page-${p}`,
  png: `${imgDir}/p${p}.png`
}));

console.log(`Sending ${images.length} floor plan images...`);

// Calculate px/m from rendering parameters
// Renderer: dpi=300, so scale = 300/72 = 4.1667
// PDF points: 1 pt = 1/72 inch = 0.3528 mm
// At plan scale 1:200: 1 pt on paper = 200 × 0.3528 mm = 70.56 mm in reality
// 1 pixel = (1/4.1667) pt = 70.56/4.1667 mm = 16.93 mm in reality
// So: 1 meter = 1000/16.93 = 59.05 pixels
// For pages rendered at lower DPI due to maxWidth cap, this changes.
// Plans p6-p7 say "schaal 1:200", p8-p13 are scanned at unknown scale.
// p6-p7 titles: "Kelder schaal 1:200", "Begane grond schaal 1:200"

const context = `This is Residentie "MURANO", Kapelstraat 55-61, 8450 Bredene.
Mixed-use apartment building with:
- Underground parking garage (level -1)
- Ground floor: supermarket (winkelruimte casco) + common areas
- Floors 1-6: apartments + common areas + balconies/terraces
Each page is a different floor level. Process ALL pages.

BUILDING SHAPE: This is a STEPPED building — upper apartment floors are SMALLER than the ground floor.
The parking garage and commercial ground floor span a WIDER footprint than the apartment tower above.
Floors 2-5 have balkons. Floor 1 has a dakterras (on the roof of the wider GV below).
Floor 6 (top) is smaller again — just apartments, no balkons.`;

try {
  const result = await extractSqm(images, modelId, {
    apiKey: API_KEY,
    context,
    timeoutMs: 300_000
  });

  console.log(`\nDone in ${(result.processingTimeMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`Cost: $${result.costUsd}`);
  console.log(`Images: ${result.imageCount} (${result.imageSizeMb} MB)\n`);

  writeFileSync(`output/test-54756/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
        }
        const bt = b.building_totals || {};
        console.log(`    TOTAL: ${bt.enclosed_sqm} enclosed, ${bt.balkons_sqm ?? bt.terraces_sqm ?? 0} balkons`);
      }
    }

    const comparison = compareExtraction(result.extraction, EXPERT);
    console.log(`\n--- Comparison vs Expert ---`);
    console.log(formatComparison(comparison));
  } else {
    console.log('PARSE FAILED — raw response:');
    console.log(result.rawText.slice(0, 500));
  }
} catch (err) {
  console.error('Error:', err.message);
}
