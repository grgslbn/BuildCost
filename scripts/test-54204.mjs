import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-542042 — BV VICTOR VICTORIA, Doorniksewijk 17, 8500 Kortrijk
// VBF (Brand-Diefstal-Nieuwb). AXA Belgium. ABEX 1056.
// Kledingzaak (clothing store), halfopen. Geklasseerd gebouw (Neoclassicistisch burgerhuis).
// Interieurarchitect: Daskal Laperre bvba.
//
// Expert Berekening (p7):
//   Gebouw 1:
//     Winkel (Niv 0): 310 m²
//     Winkel (Niv 1): 112 m²
//     Burelen (Niv 1): 115 m²
//     Opslag (Niv 2): 115 m²
//
// Total enclosed: 310 + 112 + 115 + 115 = 652 m²
// No terrassen.
const EXPERT = {
  buildings: [{
    name: 'Victor Victoria Winkelpand',
    total_enclosed_sqm: 652,
    total_terraces_sqm: 0,
    floors: [
      { level: 0, total_sqm: 310, terraces_sqm: 0 },
      { level: 1, total_sqm: 227, terraces_sqm: 0 },
      { level: 2, total_sqm: 115, terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-542042 VICTOR VICTORIA (Kortrijk) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p15 gelijkvloers architect (1/50)', png: 'output/test-54204-hires/p15.jpg' },
  { name: 'p14 verdieping architect (1/50)', png: 'output/test-54204-hires/p14.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `BV VICTOR VICTORIA, Doorniksewijk 17, 8500 Kortrijk.
VBF (Brand-Diefstal-Nieuwb). AXA Belgium. ABEX 1056.
Kledingzaak (clothing store). Halfopen. Geklasseerd gebouw (Neoclassicistisch burgerhuis).
Interieurarchitect: Daskal Laperre bvba. Totaalrenovatie kledingzaak, hoogwaardige afwerking.

SINGLE BUILDING — commercial property (retail/office):
- Niveau 0 (Gelijkvloers): Winkel (retail) = 310 m²
- Niveau 1 (Verdieping 1): Winkel 112 m² + Burelen (offices) 115 m² = 227 m²
- Niveau 2 (Verdieping 2): Opslag (storage) = 115 m²
Total enclosed: 652 m². No terrassen/balkons.

PLAN SHEETS:
- p15 = Gelijkvloers architect plan (schaal 1/50) — retail space with rooms K1-K11
- p14 = Verdieping architect plan (schaal 1/50) — offices, storage, bureau, fotostudio, kitchenette
  Upper section shows 2de verdieping area: GROENDAK, BUREAU, FOTOSTUDIO
  Lower section shows 1ste verdieping: BUREEL en STOCKAGE, HAL, KITCHENETTE, TOILET 1+2

NOTE: These are architect plans with dimension annotations. No CED per-room BO labels.
The building is a long narrow commercial property (typical Belgian row building).
Niveau 2 (Opslag 115 m²) may not have a separate plan — it's the attic/storage level.`;

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

  writeFileSync(`output/test-54204-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
