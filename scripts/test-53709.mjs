import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-537092 — RESIDENTIE FRASCATI, Coupure 316-442, 9000 Gent
// VBU (Waardebepaling+Brand), aangrenzend. Appartementsgebouw bouwjaar 1980.
// 63 appartementen, 3 ingangen, 3 liften. Centrum stad. Plat dak.
// ABEX 1057. Garageboxen buiten het gebouw.
//
// Expert Berekening (p16/p30):
//   Kelder (Niv -1): 730 m²
//   GVL (Niv 0): appartementen + gemene delen = 730 m²
//   Niv 1: 700 m², terras 105 m²
//   Niv 2: 700 m², terras 105 m²
//   Niv 3: 700 m², terras 105 m²
//   Niv 4: 700 m², terras 105 m²
//   Niv 5: 700 m², terras 105 m²
//   Niv 6: 700 m², terras 105 m²
//   Niv 7: 700 m², terras 105 m²
//   Liftkokers (Niv 8): 54 m²
//   Garageboxen (Niv 0, apart): 560 m²
//
// Total enclosed (main building): 730 + 730 + 7×700 + 54 = 6414 m²
// Total enclosed (incl garageboxen): 6414 + 560 = 6974 m²
// Total terrassen: 7 × 105 = 735 m²
const EXPERT = {
  buildings: [
    {
      name: 'Residentie Frascati',
      total_enclosed_sqm: 6414,
      total_terraces_sqm: 735,
      floors: [
        { level: -1, total_sqm: 730, terraces_sqm: 0 },
        { level: 0,  total_sqm: 730, terraces_sqm: 0 },
        { level: 1,  total_sqm: 700, terraces_sqm: 105 },
        { level: 2,  total_sqm: 700, terraces_sqm: 105 },
        { level: 3,  total_sqm: 700, terraces_sqm: 105 },
        { level: 4,  total_sqm: 700, terraces_sqm: 105 },
        { level: 5,  total_sqm: 700, terraces_sqm: 105 },
        { level: 6,  total_sqm: 700, terraces_sqm: 105 },
        { level: 7,  total_sqm: 700, terraces_sqm: 105 },
        { level: 8,  total_sqm: 54,  terraces_sqm: 0 },
      ]
    },
    {
      name: 'Garageboxen',
      total_enclosed_sqm: 560,
      total_terraces_sqm: 0,
      floors: [
        { level: 0, total_sqm: 560, terraces_sqm: 0 },
      ]
    }
  ]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-537092 RESIDENTIE FRASCATI (Gent) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p43 gelijkvloers (architect plan)', png: 'output/test-53709-hires/p43_resized.jpg' },
  { name: 'p46 typische verdieping (architect plan)', png: 'output/test-53709-hires/p46_resized.jpg' },
  { name: 'p33 garageboxen (site plan)', png: 'output/test-53709-hires/p33.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE FRASCATI, Coupure 316-442, 9000 Gent.
Appartementsgebouw, bouwjaar 1980. VBU (Waardebepaling+Brand).
63 appartementen, 3 ingangen, 3 liften (Verolift, hydraulisch).
Aangrenzend. Centrum stad. Plat dak (roofing + EPDM).
Bebouwde oppervlakte: 730 m². ABEX 1057.
Garageboxen aanwezig buiten het gebouw.
Zonnepanelen aanwezig (50 stuks, gemeenschappelijk).

BUILDING STRUCTURE (from Berekening):
- Niveau -1 (Kelder): kelders/bergingen, ~730 m² — NO PLAN PROVIDED (same footprint as GVL)
- Niveau 0 (Gelijkvloers): appartementen + gemene delen (inkomhallen, trappenhal, liften) = ~730 m²
- Niveau 1-7 (Verdiepingen): appartementen + gemene delen = ~700 m² per verdieping + terrassen ~105 m² per verdieping
- Niveau 8 (Liftkokers/machinekamer): ~54 m²
- Garageboxen (buiten het gebouw, niveau 0): ~560 m²

The building is a long rectangular apartment block along the Coupure canal.
8 residential floors above ground (niv 0-7) with nearly identical layouts (~700-730 m² per floor).
Each floor has 8-9 apartments labeled A through H.
Terrassen/balkons run along one side of the building on each floor (niv 1-7).

PLAN SHEETS:
- p43 = Gelijkvloers floor plan (original architect drawing, 1:100 scale)
- p46 = Typical verdieping floor plan (original architect drawing) — apartments labeled E,F,G,H,A,B,C,D
  Streets: COUPURE RECHTS (west side), RASPHUISSTRAAT (south side)
- p33 = Garageboxen layout plan (separate structure outside the building)

IMPORTANT: These are ORIGINAL ARCHITECT PLANS, not CED expert plans. They have dimension annotations but NO per-room BO area labels.
You must calculate room areas from the dimension annotations on the plans.
The building footprint is approximately 730 m² (bebouwde oppervlakte from the report).
Floors 1-7 are essentially identical in layout, each about 700 m².
The kelder has NO plan provided — assume same footprint as GVL (730 m²).`;

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

  writeFileSync(`output/test-53709-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
