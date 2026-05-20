import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 23-48375400034 — VME NECKERBUILDING, Ontvangstgalein à 11, 2800 Mechelen
// Gevel- en renovatiewerken aan de terrassen van een meergezinswoning.
// Architect: DES BEAUX Architecten bvba, Leopoldstraat 155, 2800 Mechelen
// Dossier 2019.02, datum 01/07/2022, schaal 1/100 - 1/25
// 2 pages: p1 = Nieuwe Toestand, p2 = Bestaande Toestand
// Building: GV + Verdieping 1 t.e.m. 5 + Dakenplan. Studios.
// Parkeerzone buiten (open fietsenstellingen, 6 parkeerplaatsen). Spoorlijn Mechelen-Antwerpen.

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 23-48375 VME NECKERBUILDING (Mechelen) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p1 nieuwe toestand — dakenplan + V1-5 + GV + gevels', png: 'output/test-48375-hires/p1.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `VME NECKERBUILDING, Ontvangstgalein à 11, 2800 Mechelen.
Meergezinswoning. Gevel- en renovatiewerken aan de terrassen.
Architect: DES BEAUX Architecten bvba.

BUILDING STRUCTURE (from plans):
- Gelijkvloers: studios (Studio 1-7 visible) + toegang
- Verdieping 1 t.e.m. 5: identical layout — studios (Studio 8-18 visible per floor)
- Dakenplan: flat roof

PLAN SHEETS:
- p1 = NIEUWE TOESTAND (current/renovated state). Contains:
  * Top-left: DAKENPLAN 1/100
  * Middle-left: VERDIEPING 1 tem. 5 — 1/100 (typical floor, repeated for V1-V5)
  * Bottom-left: GELIJKVLOERS — 1/100
  * Right side: VOORGEVEL, ACHTERGEVEL, SNEDE A (all 1/100) + detail snedes 1/25

NOTE: This is a SINGLE SHEET with multiple plans. The floor plans are on the LEFT side.
The VERDIEPING 1-5 plan represents ALL 5 upper floors (identical layout).
Dimension annotation visible: 42.66m along the building length.
Scale 1/100.`;

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

  writeFileSync('output/test-48375-hires/result-sonnet.json', JSON.stringify(result, null, 2));

  if (result.extraction) {
    const totals = result.extraction.project_totals || {};
    console.log(`AI total CAT1 (livable):     ${totals.total_cat1_sqm ?? 'N/A'} m²`);
    console.log(`AI total CAT2 (non-livable): ${totals.total_cat2_sqm ?? 'N/A'} m²`);
    console.log(`AI total CAT3 (outdoor):     ${totals.total_cat3_sqm ?? 'N/A'} m²`);
    console.log(`AI buildings: ${result.extraction.buildings?.length || 0}`);

    if (result.extraction.buildings) {
      for (const b of result.extraction.buildings) {
        console.log(`\n  ${b.name} (${b.type}):`);
        for (const f of b.floors || []) {
          const c1 = f.cat1_sqm ?? 0;
          const c2 = f.cat2_sqm ?? 0;
          const c3 = f.cat3_sqm ?? 0;
          const parts = [];
          if (c1) parts.push(`cat1:${c1}`);
          if (c2) parts.push(`cat2:${c2}`);
          if (c3) parts.push(`cat3:${c3}`);
          console.log(`    Level ${f.level}: ${parts.join(' + ')} = ${c1+c2} enclosed — ${f.measurement || ''}`);
          if (f.contents) console.log(`      Contents: ${f.contents}`);
        }
        const bt = b.building_totals || {};
        console.log(`    TOTAL: cat1=${bt.cat1_sqm}, cat2=${bt.cat2_sqm}, cat3=${bt.cat3_sqm}`);
      }
    }

    if (result.extraction.extraction_warnings?.length) {
      console.log('\nWarnings:');
      result.extraction.extraction_warnings.forEach(w => console.log('  -', w));
    }
  } else {
    console.log('PARSE FAILED — raw response:');
    console.log(result.rawText?.slice(0, 500));
  }
} catch (err) {
  console.error('Error:', err.message);
}
