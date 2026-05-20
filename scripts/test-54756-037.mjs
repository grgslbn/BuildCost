import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-547561 — LIPPENSLAAN 153, 8300 Knokke-Heist
// VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1056.
// Appartementsgebouw met handelsgelijkvloers (horeca — Asian Daily restaurant).
// Bouwjaar 2007. 7 bouwlagen + kelder. 8 appartementen. Aangrenzend.
// Bebouwde oppervlakte: 200 m². Lift. Plat dak (roofing).
// Duplex appartementen met mezzanines (split-level design).
// Architect: Marc Jacobs, Knokke.
//
// Expert Berekening (p17 — page 14/15 of CED report):
//   Bergingen (Niv -1): 200 m²
//   Handelsgelijkvloers (Niv 0): 185 m²
//   Gemene delen (Niv 0): 15 m²
//   2 appartementen en gemene delen (Niv 1): 200 m²
//   2 appartementen en gemene delen (Niv 2): 200 m²
//   2 appartementen en gemene delen (Niv 3): 200 m²
//
// Total enclosed: 200 + 200 + 200 + 200 + 200 = 1000 m²
// Total terrassen: 0 m²
// Nieuwbouwwaarde: €1.981.150
const EXPERT = {
  buildings: [{
    name: 'Lippenslaan 153',
    total_enclosed_sqm: 1000,
    total_terraces_sqm: 0,
    floors: [
      { level: -1, total_sqm: 200, terraces_sqm: 0 },
      { level: 0,  total_sqm: 200, terraces_sqm: 0 },
      { level: 1,  total_sqm: 200, terraces_sqm: 0 },
      { level: 2,  total_sqm: 200, terraces_sqm: 0 },
      { level: 3,  total_sqm: 200, terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-547561 LIPPENSLAAN 153 (Knokke) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p41 kelderverdieping (Niveau -275)', png: 'output/test-54756-037-hires/p41.jpg' },
  { name: 'p42 GVL winkelruimte (Niveau 000) — photo', png: 'output/test-54756-037-hires/p42.jpg' },
  { name: 'p43 typical floor verdiep 1-3 (Niveau 540/560)', png: 'output/test-54756-037-hires/p43-compressed.jpg' },
  { name: 'p39 verdiep 3+4 mezzanines (Niveau 1070/1335)', png: 'output/test-54756-037-hires/p39.jpg' },
  { name: 'p40 verdiep 5 + mezzanine (Niveau 1600/1865)', png: 'output/test-54756-037-hires/p40.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `LIPPENSLAAN 153 - DAKSTRAAT 4, 8300 KNOKKE-HEIST.
VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1056. Bouwjaar 2007.
Appartementsgebouw met handelsgelijkvloers (horeca — Aziatisch restaurant).
7 bouwlagen + 1 kelderverdieping. 8 appartementen. Aangrenzend. Lift.
Bebouwde oppervlakte: 200 m². Plat dak (roofing).
Architect: Marc Jacobs, Knokke-Heist. Dossier 04/202.

SINGLE BUILDING — duplex/split-level apartments with mezzanines:

1. KELDER (Niveau -275): Bergingen 1-8 + berging bij winkel = 200 m²

2. GELIJKVLOERS (Niveau 000): Handelsgelijkvloers (restaurant) 185 m² + Gemene delen 15 m² = 200 m²
   NOTE: Plan is a PHOTOGRAPH of architect plan, lower quality than scanned plans.

3. VERDIEP 1, 2, 3 (identical layout — Niveau ~540/560):
   Each floor: 2 appartementen en gemene delen = 200 m² per floor
   Split-level design: appartem. at Niveau 540 and 560 (0.20m level difference)
   3 floors × 200 m² = 600 m² total
   NOTE: Verdiep 1-3 have identical layout. Only one plan provided (represents all 3).

4. MEZZANINE LEVELS (Niveau 1070, 1335, 1600, 1865):
   Upper parts of duplex apartments. The Berekening includes mezzanine areas
   within the per-floor totals for levels 1-3. These are NOT separate floors in
   the Berekening — they are part of the apartments below.

Total enclosed: 1000 m². Total terrassen: 0 m².
Nieuwbouwwaarde: €1.981.150.

PLAN SHEETS (architect plans by Marc Jacobs):
- p41 = Kelderverdieping (Niveau -275): 8 bergingen + berging bij winkel, staircase, lift
- p42 = Gelijkvloers (Niveau 000): PHOTO of plan showing winkelruimte (restaurant) + entrance
- p43 = Typical floor plan (Niveau 540/560): appartem. /2_1 (upper) + appartem. /2_2 (lower)
  Split-level design. This layout repeats for verdiep 1, 2, and 3.
- p39 = Drawing 3/9: mezzanine appartem. /3_1 (Niveau 1070/1120) + appartem. /4_1 + mezzanine (Niveau 1335)
  Upper duplex levels of apartments on floors 2-3
- p40 = appartem. /5_1 (Niveau 1600) + mezzanine bij appartem. /5_1 (Niveau 1865)
  Top apartment (duplex). Upper part of apartment from floor 3.

NOTE: The Berekening groups all duplex/mezzanine areas into 3 upper levels at 200 m² each.
The physical building has more levels (7 bouwlagen per CED) but the mezzanines are counted
within their parent floor's area. All 200 m² per level = bebouwde oppervlakte (footprint).`;

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

  writeFileSync(`output/test-54756-037-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
