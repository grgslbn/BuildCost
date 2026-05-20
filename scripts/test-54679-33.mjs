import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-546795 — RESIDENTIE DORENBOSBEEK, Spoorwegstraat 50, 9660 Nederbrakel
// VAH (Herbouwwaarde). AXA Belgium SA. ABEX 1057.
// 2 appartementsgebouwen met garageboxen op het terrein. Alleenstaand.
// Nieuwbouw bouwjaar 2023. 13 appartementen (7+6). 2 liften. 60 zonnepanelen.
// Architect: DAT architecten.
//
// Expert Berekening (p7-p8):
//   Gebouw A (7 app):
//     GVL: gemeensch 35 + app 243 = 278 m², terrassen 68 m²
//     V1-3: gemeensch 39 + app 323 = 362 m² total, terrassen 158 m² total
//     Total enclosed: 640 m², terrassen: 226 m²
//
//   Gebouw B (6 app):
//     V0-2: gemeensch 94 + app 774 = 868 m² total
//     Terrassen (0): 80 m², Dakterrassen (1-2): 128 m²
//     Total enclosed: 868 m², terrassen: 208 m²
//
//   Garages + fietsenberging + afvalberging:
//     Niveau 0: 269 m²
//
// Grand total enclosed: 640 + 868 + 269 = 1777 m²
// Grand total terrassen: 226 + 208 = 434 m²
const EXPERT = {
  buildings: [
    {
      name: 'Gebouw A',
      total_enclosed_sqm: 640,
      total_terraces_sqm: 226,
      floors: [
        { level: 0, total_sqm: 278, terraces_sqm: 68 },
        { level: 1, total_sqm: 121, terraces_sqm: 53 },
        { level: 2, total_sqm: 121, terraces_sqm: 53 },
        { level: 3, total_sqm: 120, terraces_sqm: 52 },
      ]
    },
    {
      name: 'Gebouw B',
      total_enclosed_sqm: 868,
      total_terraces_sqm: 208,
      floors: [
        { level: 0, total_sqm: 289, terraces_sqm: 80 },
        { level: 1, total_sqm: 290, terraces_sqm: 64 },
        { level: 2, total_sqm: 289, terraces_sqm: 64 },
      ]
    },
    {
      name: 'Garages',
      total_enclosed_sqm: 269,
      total_terraces_sqm: 0,
      floors: [
        { level: 0, total_sqm: 269, terraces_sqm: 0 },
      ]
    }
  ]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-546795 RESIDENTIE DORENBOSBEEK (Nederbrakel) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p15 Gebouw A GVL + doorsnedes (1/100)', png: 'output/test-54679-33-hires/p15.jpg' },
  { name: 'p16 Gebouw A V1+V2 + gevels (1/100)', png: 'output/test-54679-33-hires/p16.jpg' },
  { name: 'p19 Gebouw B GVL+V1+V2 + doorsnedes (1/100)', png: 'output/test-54679-33-hires/p19.jpg' },
  { name: 'p17 Garages plan (1/100)', png: 'output/test-54679-33-hires/p17.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE DORENBOSBEEK, Spoorwegstraat 50, 9660 Nederbrakel.
VAH (Herbouwwaarde). AXA Belgium SA. ABEX 1057. Nieuwbouw bouwjaar 2023.
2 appartementsgebouwen met garageboxen op het terrein. Alleenstaand.
13 appartementen totaal (7 in A + 6 in B). 2 liftinstallaties. 60 zonnepanelen (28+32).
Architect: DAT architecten. Nieuwbouwwaarde €3.770.476,60.

THREE STRUCTURES:

1. GEBOUW A (7 appartementen, 4 bouwlagen):
   - Niveau 0 (GVL): gemeenschappelijke ruimte 35 m² + appartementen 243 m² = 278 m², terrassen 68 m²
   - Niveau 1-3 (3 identical upper floors): totaal gemeensch 39 + app 323 = 362 m², terrassen 158 m²
     Per floor: ~121 m² enclosed, ~53 m² terrassen
   - Total enclosed: 640 m², terrassen: 226 m²
   - Liftinstallatie. 28 zonnepanelen. Thuisbatterij.

2. GEBOUW B (6 appartementen, 3 bouwlagen):
   - Niveau 0-2 (3 floors): totaal gemeensch 94 + app 774 = 868 m²
     Per floor: ~289 m² enclosed
   - Terrassen GVL: 80 m², Dakterrassen V1-2: 128 m² total
   - Total enclosed: 868 m², terrassen: 208 m²
   - Liftinstallatie. 32 zonnepanelen.

3. GARAGES + FIETSENBERGING + AFVALBERGING:
   - Niveau 0: 269 m² (11 garages + afvalberging + fietsenstalling)

Total enclosed: 1777 m². Total terrassen: 434 m².

PLAN SHEETS (architect plans by DAT architecten, scale 1:100):
- p15 = UV/3/D — Gebouw A: 2 doorsnedes (top), fundering/riolering (bottom left), Niv 0 GVL plan (bottom right)
  Shows App A.01, App A.02 at GVL with living, kitchen, bedrooms
- p16 = UV/4/D — Gebouw A: 3 gevels (top row), Niv 1 plan (bottom left), Niv 2 plan (bottom right)
  Shows upper floor apartments with smaller footprint (stepback design)
- p19 = UV/7/E — Gebouw B: 2 doorsnedes (top), GVL plan (bottom left), V1 plan (bottom center), V2 (bottom right, small)
  Shows App B.01 through B.06 across 3 floors. Terrassen shown in green/yellow
- p17 = UV/9/A — Garages: 3 gevels (top), garage plan (bottom left) showing "11 garages - Afvalberging - Fietsenstalling"
  Also shows site context. Garage footprint 278 m² per site plan, 269 m² per Berekening

NOTE: Gebouw A has 4 above-ground levels (GVL + V1-3). V3 plan on separate sheet (p18, not included).
V1-3 are similar layout but with stepback — the Berekening groups them.
Gebouw B has 3 levels (GVL + V1-2) with setback at V2.
Both buildings have prominent terrassen/dakterrassen.`;

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

  writeFileSync(`output/test-54679-33-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
