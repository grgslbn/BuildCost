import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-542077 — RESIDENTIE DIE PRINCE, Vlaanderenstraat 78, 8400 Oostende
// VBU (Waardebepaling+Brand). AXA Belgium. ABEX 1057.
// Modern appartementsgebouw, bouwjaar ~2020. AS-BUILT architect plans.
// 10 floors (-1 to +9). Aangrenzend. Albert I-Promenade / Vlaanderenstraat.
// Liftinstallatie, zonnepanelen (28), groendak 156 m².
//
// Expert Berekening (p18):
//   Kelder (-1): bergingen, technieken, fietsberging, afvalberging = 209 m²
//   GVL (0): garages 101.90 + appartementen 101.90 + gemeenschappelijke 34.60 = 238.40 m²
//   Floors 1-8: appartementen 1657.60 + gemeenschappelijke 98.40 = 1756 m²
//   Terrassen 1-8: 193.60 m²
//   Floor 9 (penthouse): appartement 116.10, terrassen 2.20
//   Dakterrassen 8-9: 75.60 m²
//
// Total enclosed: 209 + 238.40 + 1756 + 116.10 = 2319.50 m²
// Total terrassen: 193.60 + 2.20 + 75.60 = 271.40 m²
const EXPERT = {
  buildings: [{
    name: 'Residentie Die Prince',
    total_enclosed_sqm: 2320,
    total_terraces_sqm: 271,
    floors: [
      { level: -1, total_sqm: 209, terraces_sqm: 0 },
      { level: 0,  total_sqm: 238, terraces_sqm: 0 },
      { level: 1,  total_sqm: 220, terraces_sqm: 24 },
      { level: 2,  total_sqm: 220, terraces_sqm: 24 },
      { level: 3,  total_sqm: 220, terraces_sqm: 24 },
      { level: 4,  total_sqm: 220, terraces_sqm: 24 },
      { level: 5,  total_sqm: 220, terraces_sqm: 24 },
      { level: 6,  total_sqm: 220, terraces_sqm: 24 },
      { level: 7,  total_sqm: 220, terraces_sqm: 24 },
      { level: 8,  total_sqm: 220, terraces_sqm: 24 },
      { level: 9,  total_sqm: 116, terraces_sqm: 78 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-542077 RESIDENTIE DIE PRINCE (Oostende) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p42 kelder (-1) + garages (1/50)', png: 'output/test-54207-hires/p42.jpg' },
  { name: 'p37 GVL (+0) + dakenplan (1/50)', png: 'output/test-54207-hires/p37.jpg' },
  { name: 'p41 typical floors +1 and +2 (1/50)', png: 'output/test-54207-hires/p41.jpg' },
  { name: 'p38 upper floors +7 and +8 (1/50)', png: 'output/test-54207-hires/p38.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE DIE PRINCE, Vlaanderenstraat 78 - Albert I Promenade 41, 8400 Oostende.
Appartementsgebouw, bouwjaar ~2020 (recent nieuwbouw). VBU (Waardebepaling+Brand).
AXA Belgium. ABEX 1057. Nieuwbouwwaarde €6.453.095,50.
Aangrenzend. Liftinstallatie. 28 zonnepanelen. Groendak 156 m².

BUILDING STRUCTURE (from Berekening):
- Niveau -1 (Kelder): privatieve bergingen, technieken, fietsberging, afvalberging = 209 m²
- Niveau 0 (Gelijkvloers): garages 101.90 + appartementen 101.90 + gemeenschappelijke ruimte 34.60 = 238 m²
- Niveau 1-8 (Verdiepingen): appartementen + gemeenschappelijke = ~220 m² per floor
  Terrassen: ~24 m² per floor (193.60 total for 8 floors)
- Niveau 9 (Penthouse): appartement 116 m², terrassen 2 m²
- Dakterrassen (niv 8-9): 76 m²
Total enclosed: 2320 m². Total terrassen: 271 m².

PLAN SHEETS (AS-BUILT architect plans, scale 1:50):
- p42 = Left: GRONDPLAN -1 (kelder), Right: GRONDPLAN +0 (garages)
- p37 = Left: GRONDPLAN +0 (gelijkvloers appartementen), Right: DAKENPLAN
- p41 = Left: GRONDPLAN +1, Right: GRONDPLAN +2 — TYPICAL FLOOR LAYOUT (representative of floors 1-8)
- p38 = Left: GRONDPLAN +7, Right: GRONDPLAN +8

NOTE: Floors +1 through +8 have nearly identical layouts (~220 m² each). Only 2 of 8 typical floors shown.
Level +9 penthouse (116 m²) has NO separate plan — only visible in cross section.
These are AS-BUILT architect plans with dimension annotations but NO per-room BO labels.
The building sits on corner of Vlaanderenstraat and Albert I-Promenade, triangular footprint.`;

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

  writeFileSync(`output/test-54207-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
