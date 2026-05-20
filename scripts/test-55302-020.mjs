import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 26-553026 — OCMW LINT, Liersesteenweg 62, 2547 Lint
// VAP (Publieke Sector). AXA Belgium. ABEX 1056.
// OCMW-huis: kantoren met bergingen. Halfopen. Normaal onderhouden.
// Hoofdgebouw: GVL + V1 + zolderverdieping. Separate bergingen op terrein.
// Architect: Raf Vermeere, Lint. Bouwaanvraag 9604 (1998). Scale 1:50.
//
// Expert Berekening (p6 — page 3/4 of CED report):
//   GVL kantoren en consultatiekamers (Niv 0): 246 m²
//   Verdieping (Niv 1): 99 m²
//   Polyvalente zolderruimte onder zadeldak (Niv 2): 76 m²
//   Open houten berging (Niv 0): 18 m²
//   Bergingen (Niv 0): 71 m²
//
// Total enclosed: 246 + 99 + 76 + 18 + 71 = 510 m²
// Total terrassen: 0 m²
// Lift in hoofdgebouw: €30,000
// Nieuwbouwwaarde: €1,075,550
const EXPERT = {
  buildings: [{
    name: 'OCMW Huis Lint',
    total_enclosed_sqm: 510,
    total_terraces_sqm: 0,
    floors: [
      { level: 0, total_sqm: 335, terraces_sqm: 0 },
      { level: 1, total_sqm: 99,  terraces_sqm: 0 },
      { level: 2, total_sqm: 76,  terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 26-553026 OCMW LINT (Liersesteenweg 62) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p14 plan gelijkvloers + funderings plan (1/50)', png: 'output/test-55302-020-hires/p14.jpg' },
  { name: 'p13 plan eerste verdieping + zolderverdieping (1/50)', png: 'output/test-55302-020-hires/p13.jpg' },
  { name: 'p12 gevels voorgevel/zijgevel/achtergevel', png: 'output/test-55302-020-hires/p12.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `OCMW HUIS, Liersesteenweg 62, 2547 Lint.
VAP (Publieke Sector). AXA Belgium. ABEX 1056.
OCMW-huis: kantoren met bergingen. Halfopen. Normaal onderhouden.
Lift in hoofdgebouw. Architect: Raf Vermeere, Lint.
Bouwaanvraag 9604 (1998). Scale 1:50.
Nieuwbouwwaarde: €1,075,550.

BUILDING COMPLEX on site:

1. HOOFDGEBOUW — 3 levels:
   a. GELIJKVLOERS (Niveau 0): 246 m²
      - Kantoren en consultatiekamers
      - Rooms visible on plan: receptie, burelen sociale dienst, voorzitter & schepenzaal, spreekruimte, binnenhuis, terras
   b. EERSTE VERDIEPING (Niveau 1): 99 m²
      - Offices, smaller footprint than GVL (partial first floor)
      - Plan shows rooms with dakterras area on the single-story part
   c. ZOLDERVERDIEPING (Niveau 2): 76 m²
      - Polyvalente zolderruimte onder zadeldak
      - archief, technische ruimte, polyvalente zolderruimte

2. BIJGEBOUWEN — ground floor only:
   a. Open houten berging: 18 m²
   b. Bergingen: 71 m²

Total enclosed: 246 + 99 + 76 + 18 + 71 = 510 m².
Total terrassen: 0 m² (terras visible on plan but NOT counted in Berekening).
Level 0 total (including all ground-floor structures): 246 + 18 + 71 = 335 m².

PLAN SHEETS (bouwaanvraag 9604, scale 1:50, architect Raf Vermeere):
- p14 = Sheet "ocmw-huis 1": funderings- & rioleringsplan (left) + plan gelijkvloers (right)
  GVL shows: receptie, burelen sociale dienst, voorzitter & schepenzaal, spreekruimte,
  binnenhuis (inner courtyard/garden), fietsenstalling, terras
- p13 = Sheet "ocmw-huis 2": plan eerste verdieping (left) + zolderverdieping (right)
  V1 shows: offices, dakterras over single-story part
  Zolder shows: archief, technische ruimte, polyvalente zolderruimte
- p12 = Sheet "ocmw-huis 3": gevels (elevations) — voorgevel (north), zijgevel (west), achtergevel (south/east)
  Shows pitched roof with dakkapellen (dormers), single-story wing at rear

NOTE: Old hand-drawn architect plans from 1998, scanned from original bouwaanvraag.
Bergingen are separate structures on the property — no detailed plans available.
The "binnenhuis" shown on GVL plan appears to be an enclosed courtyard/garden (not counted).`;

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

  writeFileSync(`output/test-55302-020-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
