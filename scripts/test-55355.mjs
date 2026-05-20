import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 26-553550 — LUKOR Restaurant, Jozef Vandaleplein 7, 8500 Kortrijk
// Monumentaal pand, restaurant op gelijkvloers + aangebouwde orangerie
// Verdieping: voormalige winkelruimte (casco)
// Zolderverdieping: open ruimte (casco)
// Ingesloten pand. ABEX 1056. VBN (Brand-Nieuwbouw).
//
// Plans are OLD scanned hand-drawings from when building was a shop (WINKEL).
// Renovated to restaurant in 2025. Footprint should be the same.
//
// Expert Berekening (p6):
//   [0] restaurant, bar, open keuken, toiletgroep: 254 m²
//   [0] aangebouwde orangerie: 45 m²
//   [1] verdieping, casco (voormalige winkelinrichting): 213 m²
//   [2] zolder casco: 213 m²
// Total enclosed: 254 + 45 + 213 + 213 = 725 m²
const EXPERT = {
  buildings: [{
    name: 'LUKOR Restaurant',
    total_enclosed_sqm: 725,
    total_terraces_sqm: 0,
    floors: [
      { level: 0, total_sqm: 299, terraces_sqm: 0 },
      { level: 1, total_sqm: 213, terraces_sqm: 0 },
      { level: 2, total_sqm: 213, terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 26-553550 LUKOR Restaurant (Kortrijk) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p14 plan sheet 1', png: 'output/test-55355-hires/p14.jpg' },
  { name: 'p15 plan sheet 2', png: 'output/test-55355-hires/p15.jpg' },
  { name: 'p16 plan sheet 3', png: 'output/test-55355-hires/p16.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `LUKOR Restaurant, Jozef Vandaleplein 7, 8500 Kortrijk.
Monumentaal pand (beschermd onroerend erfgoed), ingesloten.
Renovated in 2025 from shop (winkel) to restaurant.

BUILDING STRUCTURE (from dossier description):
- Niveau 0 (Gelijkvloers): Restaurant, bar, open keuken, toiletgroep + aangebouwde orangerie
- Niveau 1 (Verdieping): Voormalige winkelruimte (casco, aanwezig)
- Niveau 2 (Zolderverdieping): Open ruimte (casco)

GEEN KELDER.

NOTE: The plans are OLD architectural drawings from the original shop (WINKEL).
The building footprint is the same — only interior was renovated.
Plans may show two floor levels on a single sheet (stacked vertically or side by side).
Look for title block annotations to identify which floor is which.

The gelijkvloers includes TWO parts:
1. Main building: restaurant, bar, open keuken, toiletgroep
2. Aangebouwde orangerie (attached conservatory/extension)
Both are at niveau 0 but may appear as separate zones on plans.`;

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

  writeFileSync(`output/test-55355-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
