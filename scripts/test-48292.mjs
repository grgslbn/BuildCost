import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 23-48292 — DE NIEUWE DOKKEN, Gent
// Stepped high-rise apartment building, 15 verdiepingen + dakverdieping + gelijkvloers.
// Architect: eld (Antwerpen), Developer: SKD noordveld pergola, DE NIEUWE DOKKEN
// No basement plans in PDF (sections show Niv -02 and -01 exist but no floor plans provided).

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 23-48292 DE NIEUWE DOKKEN (Gent) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p23 gelijkvloers niveau +0.00',     png: 'output/test-48292/p23.jpg' },
  { name: 'p22 verdieping +01',                 png: 'output/test-48292/p22.jpg' },
  { name: 'p21 verdieping +02',                 png: 'output/test-48292/p21.jpg' },
  { name: 'p20 verdieping +03',                 png: 'output/test-48292/p20.jpg' },
  { name: 'p19 verdieping +04',                 png: 'output/test-48292/p19.jpg' },
  { name: 'p18 verdieping +05',                 png: 'output/test-48292/p18.jpg' },
  { name: 'p17 verdieping +06',                 png: 'output/test-48292/p17.jpg' },
  { name: 'p28 verdieping +07',                 png: 'output/test-48292/p28.jpg' },
  { name: 'p16 verdieping +08',                 png: 'output/test-48292/p16.jpg' },
  { name: 'p15 verdieping +09',                 png: 'output/test-48292/p15.jpg' },
  { name: 'p14 verdieping +10',                 png: 'output/test-48292/p14.jpg' },
  { name: 'p13 verdieping +11',                 png: 'output/test-48292/p13.jpg' },
  { name: 'p12 verdieping +12',                 png: 'output/test-48292/p12.jpg' },
  { name: 'p11 verdieping +13',                 png: 'output/test-48292/p11.jpg' },
  { name: 'p10 verdieping +14',                 png: 'output/test-48292/p10.jpg' },
  { name: 'p9 verdieping +15',                  png: 'output/test-48292/p9.jpg' },
  { name: 'p8 dakverdieping',                   png: 'output/test-48292/p8.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `DE NIEUWE DOKKEN, Gent. Koopwoningen H24.
Nieuwbouw appartementsgebouw. Stepped high-rise tower.
Architect: eld (Jan Blockhuisstraat 1, 2018 Antwerpen).
Developer: SKD noordveld pergola / DE NIEUWE DOKKEN.

BUILDING STRUCTURE (from section drawings):
- Niv -02 and -01: Underground levels (NO floor plans provided in this set)
- Niv +00 (Gelijkvloers): Ground floor — fietsenstalling, parking, common areas
- Niv +01 to +15: Apartment floors (building steps back at higher levels)
- Dakverdieping: Roof level / penthouse

PLAN SHEETS (all are "nieuwe toestand" = new state):
- p23 = Gelijkvloers, niveau +0.00 (1:100) — ground floor with fietsenstalling, parking
- p22 = Verdieping +01 (1:100)
- p21 = Verdieping +02 (1:100)
- p20 = Verdieping +03 (1:100)
- p19 = Verdieping +04 (1:100)
- p18 = Verdieping +05 (1:100)
- p17 = Verdieping +06 (1:100)
- p28 = Verdieping +07 (1:100)
- p16 = Verdieping +08 (1:100)
- p15 = Verdieping +09 (1:100)
- p14 = Verdieping +10 (1:100)
- p13 = Verdieping +11 (1:100)
- p12 = Verdieping +12 (1:100)
- p11 = Verdieping +13 (1:100)
- p10 = Verdieping +14 (1:100)
- p9 = Verdieping +15 (1:50)
- p8 = Dakverdieping (1:50)

IMPORTANT: The building is STEPPED — upper floors are smaller than lower floors.
Each floor has its own unique footprint. Measure each floor independently.
NO basement plans are included — only report what you can see.`;

try {
  const result = await extractSqm(images, modelId, {
    apiKey: API_KEY,
    context,
    timeoutMs: 600_000,
    thinking: false,
    maxTokens: 16384,
  });

  console.log(`\nDone in ${(result.processingTimeMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`Cost: $${result.costUsd}`);
  console.log(`Images: ${result.imageCount} (${result.imageSizeMb} MB)\n`);

  writeFileSync(`output/test-48292/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
          const parts = [`cat1:${c1}`];
          if (c2) parts.push(`cat2:${c2}`);
          if (c3) parts.push(`cat3:${c3}`);
          console.log(`    Level ${f.level}: ${parts.join(' + ')} = ${c1+c2} enclosed — ${f.measurement || ''}`);
        }
        const bt = b.building_totals || {};
        console.log(`    TOTAL: cat1=${bt.cat1_sqm??0}, cat2=${bt.cat2_sqm??0}, cat3=${bt.cat3_sqm??0}`);
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
