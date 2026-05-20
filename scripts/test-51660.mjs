import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 24-516605 — RESIDENTIE NOLA, Grote Baan 247-251, 1620 Drogenbos
// Nieuwbouw 2024, 3 blokken (D, E, F), 16 appartementen + 5 handelspanden
// 5 bouwlagen + parkeerkelder, niet aangrenzend, centrum stad
//
// Expert Berekening (p15):
//   Parkeerkelder onder gebouw: 766 m²
//   Parkeerkelder buiten gebouw: 661 m²
//   GVL gemene delen: 108 m²
//   GVL commercieel (ruwbouw): 658 m²
//   GVL hellingsbaan: 59 m²
//   Nivo 1 appt+circ: 732 m², terrassen 93 m², dakterras 37 m²
//   Nivo 2 appt+circ: 643 m², terrassen 69 m², dakterras 41 m²
//   Nivo 3 appt+circ: 400 m², dakterras 178 m²
//
// Total enclosed (excl parking): 108+658+59+732+643+400 = 2600 m²
// Total enclosed (incl parking): 766+661+2600 = 4027 m²
// Total terrassen/balkons: 93+37+69+41+178 = 418 m²
const EXPERT = {
  buildings: [{
    name: 'Residentie NOLA',
    total_enclosed_sqm: 4027,
    total_terraces_sqm: 418,
    floors: [
      { level: -1, total_sqm: 1427, terraces_sqm: 0 },   // parkeerkelder 766+661
      { level: 0,  total_sqm: 825,  terraces_sqm: 0 },   // gemeen 108 + commercieel 658 + hellingsbaan 59
      { level: 1,  total_sqm: 732,  terraces_sqm: 130 },  // appt+circ, terrassen 93+dakterras 37
      { level: 2,  total_sqm: 643,  terraces_sqm: 110 },  // appt+circ, terrassen 69+dakterras 41
      { level: 3,  total_sqm: 400,  terraces_sqm: 178 },  // appt+circ, dakterras 178
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 24-516605 RESIDENTIE NOLA (Drogenbos) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p26 plan ondergrond (parking)', png: 'output/test-51660-hires/p26.jpg' },
  { name: 'p27 plan gelijkvloers', png: 'output/test-51660-hires/p27.jpg' },
  { name: 'p28 plan niveau +1', png: 'output/test-51660-hires/p28.jpg' },
  { name: 'p29 plan niveau +2', png: 'output/test-51660-hires/p29.jpg' },
  { name: 'p30 plan niveau +3', png: 'output/test-51660-hires/p30.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE NOLA, Grote Baan 247-251, 1620 Drogenbos.
Nieuwbouw 2024. 3 blokken (D, E, F). 16 appartementen + 5 handelspanden (commercieel).
5 bouwlagen boven + parkeerkelder (onder + buiten het gebouw).
Niet aangrenzend (vrijstaand). Centrum stad.
Bebouwde oppervlakte: 766 m².

BUILDING STRUCTURE:
- Niveau -1: Parkeerkelder (ondergrondse parking) — deel onder het gebouw + deel buiten het gebouw
- Niveau 0 (GVL): Gemene delen (inkom, trappenhal, liften) + 5 commerciële ruimtes (ruwbouw/casco) + hellingsbaan naar parking
- Niveau 1: 6 appartementen (APP 1.1-1.6) across blok D, E, F + terrassen + dakterrassen
- Niveau 2: 6 appartementen (APP 2.1-2.6) across blok D, E, F + terrassen + dakterrassen
- Niveau 3: 3+ appartementen (APP 3.1-3.3) — reduced footprint (top floor), mainly blok D + part of E/F + large dakterrassen

3x liftinstallaties. Zonnepanelen op dak.

PLANS PROVIDED:
- p26 = Plan ondergrond (underground parking) — sheet 203
- p27 = Plan gelijkvloers (ground floor) — sheet 204
- p28 = Plan niveau +1 — sheet 205
- p29 = Plan niveau +2 — sheet 206
- p30 = Plan niveau +3 — sheet 207

These are HIGH QUALITY digital architectural plans with per-room BO labels (m² annotations).
Scale 1:100. Each apartment has its BO area labeled (e.g., "APP. 1.1 92.60m²").
Sum the apartment BO labels + common areas for each floor.

IMPORTANT: Parkeerkelder has TWO parts — "onder het gebouw" (below the building footprint) and "buiten het gebouw" (extending beyond). Both are on the same underground plan sheet.`;

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

  writeFileSync(`output/test-51660-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
