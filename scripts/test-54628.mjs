import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-546287 — RESIDENTIE BARON DE L, Fabriesstraat 48, 1770 Liedekerke
// VAH (Herbouwwaarde). AXA Belgium SA. ABEX 1056.
// 2 Buildings met ondergrondse parking. 15 appartementen. Bouwjaar 2025.
// Alleenstaand, halfopen. 3 liften. 45 zonnepanelen. Warmtepomp.
// Architect: aabbeele | moernaut.
//
// Expert Berekening (p7):
//   Kelder: Binnen de gebouwen 718 m², Buiten de gebouwen 200 m²
//   Blok A:
//     GVL: App + circulatie 225 m², Inrit parking 45 m², Terrassen 34 m²
//     Nivo 1: App + circulatie + inpandige terrassen 211 m², Dakterrassen 49 m²
//     Nivo 2: App + circulatie 174 m²
//   Blok B:
//     GVL: App + circulatie 448 m², Terrassen 143 m²
//     Nivo 1: App + circulatie 380 m², Dakterrassen 55 m²
//     Nivo 2: App + circulatie 274 m²
//
// Total enclosed: 918 + 655 + 1102 = 2675 m²
// Total terrassen: 83 + 198 = 281 m²
const EXPERT = {
  buildings: [
    {
      name: 'Kelder/Parking',
      total_enclosed_sqm: 918,
      total_terraces_sqm: 0,
      floors: [
        { level: -1, total_sqm: 918, terraces_sqm: 0 },
      ]
    },
    {
      name: 'Blok A',
      total_enclosed_sqm: 655,
      total_terraces_sqm: 83,
      floors: [
        { level: 0, total_sqm: 270, terraces_sqm: 34 },
        { level: 1, total_sqm: 211, terraces_sqm: 49 },
        { level: 2, total_sqm: 174, terraces_sqm: 0 },
      ]
    },
    {
      name: 'Blok B',
      total_enclosed_sqm: 1102,
      total_terraces_sqm: 198,
      floors: [
        { level: 0, total_sqm: 448, terraces_sqm: 143 },
        { level: 1, total_sqm: 380, terraces_sqm: 55 },
        { level: 2, total_sqm: 274, terraces_sqm: 0 },
      ]
    }
  ]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-546287 RESIDENTIE BARON DE L (Liedekerke) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p11 kelder/parking plan', png: 'output/test-54628-hires/p11.jpg' },
  { name: 'p12 Blok B GVL+V1+V2 (1/100)', png: 'output/test-54628-hires/p12.jpg' },
  { name: 'p13 Blok A GVL+V1+V2 (1/100)', png: 'output/test-54628-hires/p13.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE BARON DE L, Fabriesstraat 48, 1770 Liedekerke.
VAH (Herbouwwaarde). AXA Belgium SA. ABEX 1056. Bouwjaar 2025.
15 appartementen verdeeld over 2 blokken met gedeelde ondergrondse parking.
Alleenstaand, halfopen. 3 liften. 45 zonnepanelen. Warmtepomp.
Architect: aabbeele | moernaut. Nieuwbouwwaarde €4.999.377,50.

THREE STRUCTURES (shared underground + 2 above-ground blocks):

1. KELDER/PARKING (shared underground):
   - Binnen de gebouwen: 718 m²
   - Buiten de gebouwen: 200 m²
   - Total: 918 m² (20 ondergrondse parkeerplaatsen)

2. BLOK A (smaller block):
   - Gelijkvloers: App + circulatie 225 m², Inrit parking 45 m² = 270 m² enclosed, Terrassen 34 m²
   - Nivo 1: App + circulatie + inpandige terrassen 211 m², Dakterrassen 49 m²
   - Nivo 2: App + circulatie 174 m²
   - Total enclosed: 655 m², terrassen: 83 m²

3. BLOK B (larger block):
   - Gelijkvloers: App + circulatie 448 m², Terrassen 143 m²
   - Nivo 1: App + circulatie 380 m², Dakterrassen 55 m²
   - Nivo 2: App + circulatie 274 m²
   - Total enclosed: 1102 m², terrassen: 198 m²

Total enclosed: 2675 m². Total terrassen: 281 m².

PLAN SHEETS (architect plans by aabbeele | moernaut):
- p11 = Kelder/parking floor plan — underground parking with 20 spaces, bergingen, technical rooms
- p12 = Blok B floor plans: 3 plans on one sheet — GVL (left), 1e verdieping (center), 2e verdieping (right) at 1:100
- p13 = Blok A floor plans: 2e verdieping A (top left), GVL A (bottom left), 1e verdieping A (bottom center) at 1:100
  Also shows facades (voorgevel, achtergevel, zijgevel) and site plan

NOTE: These are high-quality digital architect plans at 1:100 scale with room labels.
15 apartments total across both blocks. The kelder extends under and between both buildings.`;

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

  writeFileSync(`output/test-54628-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
