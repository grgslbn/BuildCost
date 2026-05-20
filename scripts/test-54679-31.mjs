import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-546796 — RESIDENTIE SANGLIER, Eindeken 11, 9940 Evergem
// VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1057.
// "Technische Inspectie" CED format (14 pages).
// 24 appartementen + 1 handelspand (snoepwinkel). 3 liften.
// Single building, 6 levels (-1 to +4). Alleenstaand.
// Architect: Kobe De Groote / Dm Consult BVBA.
//
// Expert Berekening (p16 — page 13/14 of CED report):
//   Niveau -1 (Kelder/parking): 1500 m²
//   Niveau 0 (GVL): Handelspand 79 + App 376 + Garages 263 = 718 m²
//   Niveau 1: App 675 m², Terrassen 130 m²
//   Niveau 2: App 615 m², Terrassen 65 m²
//   Niveau 3: App 440 m², Terrassen 55 m²
//   Niveau 4: App 247 m²
//
// Total enclosed: 1500 + 718 + 675 + 615 + 440 + 247 = 4195 m²
// Total terrassen: 130 + 65 + 55 = 250 m²
const EXPERT = {
  buildings: [{
    name: 'Residentie Sanglier',
    total_enclosed_sqm: 4195,
    total_terraces_sqm: 250,
    floors: [
      { level: -1, total_sqm: 1500, terraces_sqm: 0 },
      { level: 0,  total_sqm: 718,  terraces_sqm: 0 },
      { level: 1,  total_sqm: 675,  terraces_sqm: 130 },
      { level: 2,  total_sqm: 615,  terraces_sqm: 65 },
      { level: 3,  total_sqm: 440,  terraces_sqm: 55 },
      { level: 4,  total_sqm: 247,  terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-546796 RESIDENTIE SANGLIER (Evergem) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p35 kelder/parking (AS 01/02, 1/100)', png: 'output/test-54679-31-hires/p35.jpg' },
  { name: 'p36 gelijkvloers + voorgevel (1/100)', png: 'output/test-54679-31-hires/p36.jpg' },
  { name: 'p41 niveau 01 + achtergevel (1/100)', png: 'output/test-54679-31-hires/p41.jpg' },
  { name: 'p40 niveau 02 + doorsnedes (1/100)', png: 'output/test-54679-31-hires/p40.jpg' },
  { name: 'p37 niveau 03 + garage snedes (1/100)', png: 'output/test-54679-31-hires/p37.jpg' },
  { name: 'p38 niveau 04 + dakenplan (1/100)', png: 'output/test-54679-31-hires/p38.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE SANGLIER, Eindeken 11, 9940 Evergem.
VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1057.
24 appartementen + 1 handelspand (snoepwinkel). 3 liftinstallaties. Alleenstaand.
Architect: Kobe De Groote / Dm Consult BVBA. Nieuwbouw.

SINGLE BUILDING — 6 levels (-1 to +4):

1. NIVEAU -1 (Kelder/ondergrondse parking):
   - Ondergrondse parking + bergingen + technische ruimten = 1500 m²
   - Plan shows "ONDERGRONDSE PARKING" with parking spaces P1-P36
   - "totale oppervlakte compartiment parking 1115 m²" + "totaal vloerplaat kelder 1476 m² brutto"

2. NIVEAU 0 (Gelijkvloers):
   - Handelspand (snoepwinkel) 79 m² + Appartementen 376 m² + Garages 263 m² = 718 m²
   - Shows garages, handelspand, and ground-floor apartments

3. NIVEAU 1 (1ste verdieping):
   - Appartementen 675 m², Terrassen 130 m²
   - Multiple apartments with terraces along the front

4. NIVEAU 2 (2de verdieping):
   - Appartementen 615 m², Terrassen 65 m²
   - Setback from niveau 1 (smaller footprint)

5. NIVEAU 3 (3de verdieping):
   - Appartementen 440 m², Terrassen 55 m²
   - Further setback (duplex upper floors)

6. NIVEAU 4 (4de verdieping):
   - Appartementen 247 m²
   - Top floor, smallest footprint (duplex upper levels)

Total enclosed: 4195 m². Total terrassen: 250 m².

PLAN SHEETS (architect plans by Kobe De Groote / Dm Consult, scale 1:100):
- p35 = AS 01/AS 02 — Detailed kelder plan with parking spaces P1-P36, bergingen, bronbemaling
- p36 = Gelijkvloers floor plan (top) + voorgevel facade (bottom). Shows handelspand + garages + apartments
- p41 = Niveau 01 floor plan (top) + nieuwe achtergevel facade (bottom). Terraces labeled "terras" along front
- p40 = Niveau 02 floor plan (top) + snede A + snede Achtergevel (bottom). Smaller footprint than N01
- p37 = Niveau 03 floor plan (top) + garage sections (bottom). Duplex apartments labeled 13-0301 etc.
- p38 = Niveau 04 floor plan (top) + dakenplan + garage profiles (bottom). Smallest floor, top of duplexes

NOTE: Duplex apartments span N03+N04. N03 has living areas, N04 has bedrooms.
The building steps back at each level (widest at GVL, narrowest at N04).
Unit numbering: XX-YYZZ where XX=block, YY=floor, ZZ=unit number.`;

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

  writeFileSync(`output/test-54679-31-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
