import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-540243 — RESIDENTIE VICTORINE, Kleinesteenweg 50, 3130 Begijnendijk
// VNB (Nieuwbouw). AXA Belgium SA. ABEX 1057.
// Two separate structures: apartment building (5 units) + 3 geschakelde woningen.
// Architect: Irarto Architecten.
//
// Expert Berekening (p6):
//   Building (5 app):
//     Kelder, garages: 747 m²
//     GVL appartementen: 436 m²
//     Nivo 1 appartementen: 357 m², terrassen: 63 m²
//     Nivo 2 appartementen: 310 m², terrassen: 48 m²
//     Total enclosed: 1850 m², terrassen: 111 m²
//
//   Drie geschakelde woningen:
//     GVL: 234 m²
//     Verdieping: 220 m²
//     Total enclosed: 454 m²
//
// Grand total enclosed: 2304 m², total terrassen: 111 m²
const EXPERT = {
  buildings: [
    {
      name: 'Building Appartementen',
      total_enclosed_sqm: 1850,
      total_terraces_sqm: 111,
      floors: [
        { level: -1, total_sqm: 747, terraces_sqm: 0 },
        { level: 0,  total_sqm: 436, terraces_sqm: 0 },
        { level: 1,  total_sqm: 357, terraces_sqm: 63 },
        { level: 2,  total_sqm: 310, terraces_sqm: 48 },
      ]
    },
    {
      name: 'Drie geschakelde woningen',
      total_enclosed_sqm: 454,
      total_terraces_sqm: 0,
      floors: [
        { level: 0, total_sqm: 234, terraces_sqm: 0 },
        { level: 1, total_sqm: 220, terraces_sqm: 0 },
      ]
    }
  ]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-540243 RESIDENTIE VICTORINE (Begijnendijk) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p18 appartementen GVL+V1+V2 (1/50)', png: 'output/test-54024-hires/p18.jpg' },
  { name: 'p22 kelderindeling (1/100)', png: 'output/test-54024-hires/p22.jpg' },
  { name: 'p23 geschakelde woningen GVL+V1 (1/50)', png: 'output/test-54024-hires/p23.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE VICTORINE, Kleinesteenweg 50, 3130 Begijnendijk.
VNB (Nieuwbouw). AXA Belgium SA. ABEX 1057.
Architect: Irarto Architecten. Aanvraag tot omgevingsvergunning.
Project: slopen etagewoning + 2 magazijnen + 2 bijgebouwen, herbouwen meergezinswoning met 5 units + oprichten 3 eengezinswoningen.

TWO SEPARATE STRUCTURES:

1. BUILDING — Meergezinswoning (5 appartementen):
   - Niveau -1 (Kelder): garages, kelders, installaties = 747 m²
   - Niveau 0 (GVL): 5 appartementen = 436 m²
   - Niveau 1 (Verdieping 1): appartementen = 357 m², terrassen = 63 m²
   - Niveau 2 (Verdieping 2): appartementen = 310 m², terrassen = 48 m²
   Total enclosed: 1850 m², terrassen: 111 m²
   Liften: 2 stuks met 4 stopplaatsen

2. DRIE GESCHAKELDE WONINGEN (3 linked houses):
   - Niveau 0 (GVL): 234 m²
   - Niveau 1 (Verdieping): 220 m²
   Total enclosed: 454 m²

PLAN SHEETS:
- p18 = Appartementen floor plans: 3 plans on one sheet (GVL, V1, V2) at schaal 1/50
  Top left = gelijkvloers 436m², Top right = verdieping 1 357m², Bottom left = verdieping 2 310m²
- p22 = Kelderindeling at schaal 1/100 — underground parking with garages and storage units
- p23 = Geschakelde woningen: Top right = gelijkvloers 3 houses (234m²), Bottom center = verdieping (220m²)
  Also shows site/foundation plan at top left

NOTE: p18 and p23 are HIGH QUALITY digital architect plans at 1/50 scale with full dimension annotations.
p22 kelder plan is at 1/100 scale.`;

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

  writeFileSync(`output/test-54024-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
