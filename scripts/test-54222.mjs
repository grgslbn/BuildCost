import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-542228 — LA TACHE, Blankenberge Steenweg 1, 8000 Brugge
// VBN (Brand-Nieuwbouw). AXA Belgium. ABEX 1057.
// Luxueus afgewerkt restaurant met bijhorend appartement. Halfopen.
// Zonnepanelen (20). Koelcel.
//
// Expert Berekening (p6):
//   Restaurant + keuken (Niv 0): 275 m²
//   Kelder (Niv -1): 275 m²
//   Appartement (Niv 1): 165 m²
//   Appartement (Niv 2): 110 m²
//   Terras (Niv 1): 18 m²
//
// Total enclosed: 275 + 275 + 165 + 110 = 825 m²
// Total terrassen: 18 m²
const EXPERT = {
  buildings: [{
    name: 'La Tache',
    total_enclosed_sqm: 825,
    total_terraces_sqm: 18,
    floors: [
      { level: -1, total_sqm: 275, terraces_sqm: 0 },
      { level: 0,  total_sqm: 275, terraces_sqm: 0 },
      { level: 1,  total_sqm: 165, terraces_sqm: 18 },
      { level: 2,  total_sqm: 110, terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-542228 LA TACHE (Brugge) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p7 gelijkvloers hand-drawn plan (1/100)', png: 'output/test-54222-hires/p7.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `LA TACHE, Blankenberge Steenweg 1, 8000 Brugge.
VBN (Brand-Nieuwbouw). AXA Belgium. ABEX 1057.
Luxueus afgewerkt restaurant met bijhorend appartement. Halfopen.
Eigenaar + uitbater + bewoner. Zonnepanelen (20). Koelcel.

SINGLE BUILDING — mixed commercial/residential:
- Niveau -1 (Kelder): 275 m² — NO PLAN PROVIDED, same footprint as GVL
- Niveau 0 (Gelijkvloers): Restaurant + keuken = 275 m²
- Niveau 1: Appartement 165 m², Terras 18 m²
- Niveau 2: Appartement 110 m²
Total enclosed: 825 m². Terrassen: 18 m².

PLAN SHEETS:
- p7 = PHOTOGRAPH of hand-drawn architect plan (scale 1/100)
  Shows gelijkvloers only: LIVING, VERANDA (curved glass), KEUKEN, HAL,
  EETPLAATS, SALON, HOOFDINGANG, INRY (entrance)
  Old hand-drawn plan with dimension annotations in meters

NOTE: Only 1 plan available — gelijkvloers at 1/100.
No plans for kelder, 1st floor or 2nd floor.
The kelder has same footprint as GVL (275 m²).
The upper floors (165 + 110 m²) are apartments above the restaurant.`;

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

  writeFileSync(`output/test-54222-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
