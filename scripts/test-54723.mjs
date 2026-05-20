import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-547233 — VME RESIDENTIE MAURICE, Knokkestraat 683-685, 8300 Knokke
// VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1056.
// Appartementsgebouw met handelsgelijkvloers. Alleenstaand.
// 7 levels (-2 to +4). 3 personenliften + 1 autolift. 38 zonnepanelen.
// Architect: PROJECT ARCHITECTS. Nieuwbouw.
//
// Expert Berekening (p15 — page 12/13 of CED report):
//   Kelder/garages -2: 800 m²
//   Kelder/garages -1: 800 m²
//   Handelspand (casco) GVL: 390 m²
//   Appartementen/gemene delen GVL: 439 m²
//   Appartementen/gemene delen V1: 670 m², terras 55 m²
//   Appartementen/gemene delen V2: 670 m², terras 55 m²
//   Penthouse V3: 350 m², terras 30 m²
//   Penthouse V4: 320 m², terras 30 m²
//
// Total enclosed: 800+800+829+670+670+350+320 = 4439 m²
// Total terrassen: 55+55+30+30 = 170 m²
// Nieuwbouwwaarde: €9,348,200
const EXPERT = {
  buildings: [{
    name: 'Residentie Maurice',
    total_enclosed_sqm: 4439,
    total_terraces_sqm: 170,
    floors: [
      { level: -2, total_sqm: 800,  terraces_sqm: 0 },
      { level: -1, total_sqm: 800,  terraces_sqm: 0 },
      { level: 0,  total_sqm: 829,  terraces_sqm: 0 },
      { level: 1,  total_sqm: 670,  terraces_sqm: 55 },
      { level: 2,  total_sqm: 670,  terraces_sqm: 55 },
      { level: 3,  total_sqm: 350,  terraces_sqm: 30 },
      { level: 4,  total_sqm: 320,  terraces_sqm: 30 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-547233 RESIDENTIE MAURICE (Knokke) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p57 kelder -1 parking plan (PROJECT ARCHITECTS)', png: 'output/test-54723-hires/p57.jpg' },
  { name: 'p56 gelijkvloers handelspand + appartementen', png: 'output/test-54723-hires/p56.jpg' },
  { name: 'p60 verdieping 1 typical apartment floor', png: 'output/test-54723-hires/p60.jpg' },
  { name: 'p63 verdieping 3 penthouse level', png: 'output/test-54723-hires/p63.jpg' },
  { name: 'p64 verdieping 4 top penthouse', png: 'output/test-54723-hires/p64.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `VME RESIDENTIE MAURICE, Knokkestraat 683-685, 8300 Knokke.
VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1056. Nieuwbouw.
Appartementsgebouw met handelsgelijkvloers (casco). Alleenstaand.
7 levels (-2 to +4). 3 personenliften + 1 autolift. 38 zonnepanelen.
Architect: PROJECT ARCHITECTS. Nieuwbouwwaarde: €9,348,200.

SINGLE BUILDING — 7 levels:

1. KELDER -2 (Niveau -2): 800 m²
   - Underground parking + bergingen (spaces 14-24)
   - Same footprint as Kelder -1

2. KELDER -1 (Niveau -1): 800 m²
   - Underground parking + bergingen (spaces 1-13)
   - Same footprint as Kelder -2

3. GELIJKVLOERS (Niveau 0): 829 m² total
   - Handelspand (casco): 390 m²
   - Appartementen + gemene delen: 439 m²

4. VERDIEPING 1 (Niveau 1): 670 m², terrassen 55 m²
   - Appartementen + gemene delen
   - Same layout as Verdieping 2

5. VERDIEPING 2 (Niveau 2): 670 m², terrassen 55 m²
   - Same layout as Verdieping 1 (plan not included, identical)

6. VERDIEPING 3 (Niveau 3): 350 m², terrassen 30 m²
   - Penthouse level, significantly smaller footprint (setback)
   - Roof terraces on lower rooftop areas

7. VERDIEPING 4 (Niveau 4): 320 m², terrassen 30 m²
   - Top penthouse, smallest footprint
   - Roof terraces

Total enclosed: 4439 m². Total terrassen: 170 m².

PLAN SHEETS (architect plans by PROJECT ARCHITECTS):
- p57 = Kelder -1: parking plan with spaces 1-13, bergingen, autolift
  Kelder -2 has identical footprint (800m²) with spaces 14-24 (not included)
- p56 = Gelijkvloers: handelspand (casco) + appartementen + gemene delen
  Shows kantoorruimte, inkom kantoor, and apartment units
- p60 = Verdieping 1: typical apartment floor with terraces
  V2 has identical layout (not included separately)
- p63 = Verdieping 3: penthouse level, smaller footprint with roof garden
- p64 = Verdieping 4: top penthouse, smallest footprint

NOTE: Plans have dimension annotations and area tables in the title block.
The building has a triangular plot shape (wedge-shaped, narrowing toward one end).
"10% onbebouwde opp" annotation visible on plans refers to unbuild portion of plot.
All plans by PROJECT ARCHITECTS with brandcompartimenten (fire compartment) markings.`;

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

  writeFileSync(`output/test-54723-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
