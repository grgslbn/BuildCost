import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Expert Berekening (dossier 25-547281, Aalter, p6 of VerzamelPDF)
// VAN DER MAST — Accountantskantoor met appartement (verbouwing schuur → kantoor + bovenwoning)
//
// Kantoorruimte:
//   Niveau 0: kantoren, ontvangstruimte = 396 m²
//
// Bovenwoning, appartement:
//   Niveau 1: leefruimtes, slaapkamers, badkamers = 389 m²
//   Niveau 0: entree trapopgang = 20 m²
//   Niveau 0: tuinberging = 40 m²
//   Niveau 1: dakterras = 40 m² (OUTDOOR)
//   Niveau 1: loggia = 7.5 m² (inpandig → enclosed)
//   Niveau 2: mezzanine = 40 m²
//
// Total enclosed: 396 + 20 + 40 + 389 + 7.5 + 40 = 892.5 m²
// Total balkons (dakterras): 40 m²
// Total kapital: € 1.845.835 (incl 21% btw, ABEX 1057)
const EXPERT = {
  buildings: [{
    name: 'Kantoor + Bovenwoning Van Der Mast',
    total_enclosed_sqm: 893,
    total_terraces_sqm: 40,
    floors: [
      { level: 0, total_sqm: 456, terraces_sqm: 0 },   // kantoren 396 + entree 20 + tuinberging 40
      { level: 1, total_sqm: 397, terraces_sqm: 40 },  // leefruimtes 389 + loggia 7.5 = 396.5; dakterras 40 outdoor
      { level: 2, total_sqm: 40,  terraces_sqm: 0 },   // mezzanine
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-547281 VAN DER MAST (kantoor+appt Aalter) on ${modelName} (${modelId}) ===\n`);

// p14 = ONTWORPEN toestand (designed/new — what's being built per Berekening)
// p15 = bestaand (existing/old)
// p16 = verbouwen schuur → kantoorruimte
// Use p14 (designed state) which matches the Nieuwbouwwaarde Berekening.
// p17/p18 are additional plan sheets — include for context.
const images = [
  { name: 'p14 ontworpen toestand', png: 'output/test-54728-hires/p14.jpg' },
  { name: 'p17 plans', png: 'output/test-54728-hires/p17.jpg' },
  { name: 'p18 plans', png: 'output/test-54728-hires/p18.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `BV VAN DER MAST, Steenweg op Deinze 116A, 9880 Aalter.
Verbouwing van een bestaande schuur naar kantoorruimte (accountantskantoor) met uitbreiding bovenwoning.
Nieuwbouwwaarde wordt berekend voor de ontworpen toestand (DESIGNED state, NOT existing).

BUILDING STRUCTURE:
- Niveau 0 (Gelijkvloers): kantoorruimte (kantoren, vergaderzaal, keuken, sanitair, polyvalente ruimte, bureaus, garage, vestiairesvochier, technische ruimte), entree/trapopgang voor bovenwoning, tuinberging.
- Niveau 1 (Verdieping): bovenwoning appartement (4 slaapkamers, dressing, nachthal, badkamers, terras, berging, overloop, tech, loggia).
- Niveau 2 (Zolder/Mezzanine): mezzanine ruimte.

GEEN KELDER — single-floor office at GV + apartment above + mezzanine.

OUTDOOR:
- Dakterras op niveau 1 (op het dak van een lagere uitbouw of als terras aan de zijde)
- Loggia op niveau 1 is INPANDIG (binnen het bouwvolume) → enclosed

PLAN SHEET p14:
- TOP plan = RIOLERING & FUNDERINGSPLAN (foundations — not for area measurement)
- MIDDLE plan = GELIJKVLOERS COMPARTIMENTERING (ground floor designed state) — measure this for niveau 0
- BOTTOM plan = VERDIEPING (designed state) — measure this for niveau 1

p17/p18 are additional reference plans.

The building has been measured by an expert as: niveau 0 = 456 m² (kantoor 396 + entree 20 + tuinberging 40), niveau 1 = ~397 m² (leefruimtes 389 + loggia 7.5), niveau 2 mezzanine = 40 m². But your task is to measure independently from the plans.

DIMENSIONS: building dimension annotations are visible on the plans (look for chains like B0.01-B0.10 labels with sub-dimensions). Plans drawn at scale 1:50 or 1:100.`;

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

  writeFileSync(`output/test-54728-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
