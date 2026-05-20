import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-54756000022 — Residentie MURANO, Kapelstraat 55-61, 8450 Bredene
// VBU (Waardebepaling+Brand). Mixed-use. ABEX 1056.
// Stepped building: kelder + GV commercial + 6 apartment floors.
//
// Expert Berekening:
//   [-1] parkeergarage: 1016 m²
//   [0]  winkelruimte (casco): 963 m² + gemeenschappelijk: 54 m²
//   [1-6] appartementen: 1698 m² (= 283/floor)
//   [1-5] gemeenschappelijk: 90 m² (= 18/floor)
//   [2-5] balcons: 198 m² (= 49.5/floor)
//   [1]  dakterrassen: 40 m²
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

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-54756-022 RESIDENTIE MURANO (Bredene) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p39 Kelder schaal 1/200',         png: 'output/test-54756-022-hires/p39.jpg' },
  { name: 'p40 Begane grond schaal 1/200',    png: 'output/test-54756-022-hires/p40.jpg' },
  { name: 'p41 1ste verdieping schaal 1/100', png: 'output/test-54756-022-hires/p41.jpg' },
  { name: 'p42 2de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p42.jpg' },
  { name: 'p43 3de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p43.jpg' },
  { name: 'p44 4de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p44.jpg' },
  { name: 'p45 5de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p45.jpg' },
  { name: 'p46 6de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p46.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `Residentie "MURANO", Kapelstraat 55-61, 8450 Bredene.
VBU (Waardebepaling+Brand). Mixed-use apartment building. ABEX 1056.

BUILDING STRUCTURE — STEPPED BUILDING:
- Level -1: Underground parking garage (full footprint under entire building)
- Level 0: Supermarket (winkelruimte casco) + common areas (inkomhal, lift, trap)
- Levels 1-6: Apartments + common areas
  - Each floor has apartments (SLAAPKAMER, EETPLAATS, KEUKEN, BADKAMER, etc.)
  - Floors 2-5 have TERRAS (balkons) on both sides
  - Floor 1 has dakterras on roof of wider GV below
  - Floor 6 (top) has no balkons — smaller footprint

CRITICAL: This is a STEPPED building. The parking garage and commercial ground floor span
a WIDER footprint than the apartment tower above. Upper apartment floors are SMALLER.
Floor 6 is smaller again. Measure each floor INDEPENDENTLY from its own plan.

MIXED SCALES:
- p39 (kelder) and p40 (GV): schaal 1/200 — calibrate from dimension annotations
- p41-p46 (floors 1-6): schaal 1/100 — calibrate separately from dimension annotations
Each plan has its own scale. Do NOT mix calibrations between different scale plans.`;

try {
  const result = await extractSqm(images, modelId, {
    apiKey: API_KEY,
    context,
    timeoutMs: 300_000,
    thinking: false
  });

  console.log(`\nDone in ${(result.processingTimeMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`Cost: $${result.costUsd}`);
  console.log(`Images: ${result.imageCount} (${result.imageSizeMb} MB)\n`);

  mkdirSync('output/test-54756-022-hires', { recursive: true });
  writeFileSync(`output/test-54756-022-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
