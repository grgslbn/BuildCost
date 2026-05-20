import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 23-48399700083 — VALLEI HOUTKAUTER, Houtkauter, 1770 Liedekerke
// Multi-building apartment complex with large underground parking.
// Architect: Arcas Flemish Brabant & Bxl, Scholenstraat 200, B-9100 Aalst
// Multiple apartment blocks (3+ buildings), stepped design, 3-4 floors above ground.
// Large underground parking/bergingen slab.

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 23-48399 VALLEI HOUTKAUTER (Liedekerke) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p3 kelder/parking — underground level',      png: 'output/test-48399-hires/p3.jpg' },
  { name: 'p4 gelijkvloers — apartments + parking',      png: 'output/test-48399-hires/p4.jpg' },
  { name: 'p1 gelijkvloers — site plan with apartments', png: 'output/test-48399-hires/p1.jpg' },
  { name: 'p5 verdieping 1',                             png: 'output/test-48399-hires/p5.jpg' },
  { name: 'p7 verdieping 2 (stepped — side blocks)',     png: 'output/test-48399-hires/p7.jpg' },
  { name: 'p8 verdieping 3 (with BO labels)',            png: 'output/test-48399-hires/p8.jpg' },
  { name: 'p6 dakenplan',                                png: 'output/test-48399-hires/p6.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `VALLEI HOUTKAUTER, Houtkauter, 1770 Liedekerke.
Multi-building apartment complex. Nieuwbouw.
Architect: Arcas Flemish Brabant & Bxl, Scholenstraat 200, B-9100 Aalst.

BUILDING STRUCTURE (from plans and section):
- Multiple apartment blocks (at least 3 separate buildings) arranged around a central garden
- Large underground parking/bergingen slab connecting all buildings
- Stepped design: upper floors are smaller than lower floors
- Approximately 3-4 above-ground levels per block
- Underground level with parking garage, bergingen, technical rooms

PLAN SHEETS:
- p3 = Kelder/parking level — underground parking + bergingen + technical
- p4 = Gelijkvloers detail — apartments + underground parking visible
- p1 = Gelijkvloers — site overview with all apartment blocks and gardens
- p5 = Verdieping 1 — upper floor
- p7 = Verdieping 2 — stepped (only side blocks visible, center block stops)
- p8 = Verdieping 3 — top floor with BO labels visible
- p6 = Dakenplan — roof plan with green roofs and dakterrassen

NOTE: Plans have red dimension annotations and BO labels. Multiple buildings on same sheet.
The underground parking appears to be one continuous slab under all buildings.`;

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

  writeFileSync('output/test-48399-hires/result-sonnet.json', JSON.stringify(result, null, 2));

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
