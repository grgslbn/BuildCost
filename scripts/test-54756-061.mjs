import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-547563 — RESIDENTIE HOOST, Maes en Boereboomplein 1, 8301 Heist-aan-Zee
// VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1056.
// Appartementsgebouw. Bouwjaar 2025 (nieuwbouw). 97 appartementen.
// Alleenstaand. 16 bouwlagen (-2 t/m 13). 4 liften + 1 huishoudlift.
// Bebouwde oppervlakte: 1445 m². Architect: ARTES/B2Ai/Caaap.
// GVL + V1 = casco (verhuurd aan stad Knokke: zaal/bibliotheek/café + kantoren).
// 2 separate retail gebouwen op terrein NIET opgenomen.
//
// Expert Berekening (p16-p17 — page 13-14/15 of CED report):
//   Garage/kelder -2: 5931.45 m² (80.70×73.50)
//   Garage/kelder -1: 5931.45 m² (80.70×73.50)
//   GVL (0): Zaal/bibl/café casco 1265 + Gemene delen 170 = 1435 m²
//   V1 (1): Kantoren casco 927 + Gemene delen 155 = 1082 m²
//   V2 (2): Binnenruimte 330 + App/gem 1060 = 1390 m², terrassen 55 m²
//   V3 (3): Multifunct. 67 + App/gem 1070 = 1137 m², terrassen 52 m²
//   V4 (4): App/gem 1244 m², terrassen 68 m²
//   V5 (5): App/gem 1242 m², terrassen 72 m²
//   V6 (6): App/gem 1225 m², terrassen 89 m²
//   V7 (7): App/gem 1132 m², terrassen 71 m²
//   V8 (8): App/gem 1240 m², terrassen 74 m²
//   V9 (9): App/gem 1105 m², terrassen 68 m²
//   V10 (10): App/gem 1227 m², terrassen 87 m²
//   V11 (11): App/gem 1226 m², terrassen 88 m²
//   V12 (12): App/gem 1095 m², terrassen/buiteruimte 224 m²
//   V13 (13): App/gem 1003 m², terrassen 65 m²
//
// Total enclosed: 28645.90 m²
// Total terrassen: 1013 m²
// Nieuwbouwwaarde: €57,065,550
const EXPERT = {
  buildings: [{
    name: 'Residentie Hoost',
    total_enclosed_sqm: 28645.90,
    total_terraces_sqm: 1013,
    floors: [
      { level: -2, total_sqm: 5931.45, terraces_sqm: 0 },
      { level: -1, total_sqm: 5931.45, terraces_sqm: 0 },
      { level: 0,  total_sqm: 1435,    terraces_sqm: 0 },
      { level: 1,  total_sqm: 1082,    terraces_sqm: 0 },
      { level: 2,  total_sqm: 1390,    terraces_sqm: 55 },
      { level: 3,  total_sqm: 1137,    terraces_sqm: 52 },
      { level: 4,  total_sqm: 1244,    terraces_sqm: 68 },
      { level: 5,  total_sqm: 1242,    terraces_sqm: 72 },
      { level: 6,  total_sqm: 1225,    terraces_sqm: 89 },
      { level: 7,  total_sqm: 1132,    terraces_sqm: 71 },
      { level: 8,  total_sqm: 1240,    terraces_sqm: 74 },
      { level: 9,  total_sqm: 1105,    terraces_sqm: 68 },
      { level: 10, total_sqm: 1227,    terraces_sqm: 87 },
      { level: 11, total_sqm: 1226,    terraces_sqm: 88 },
      { level: 12, total_sqm: 1095,    terraces_sqm: 224 },
      { level: 13, total_sqm: 1003,    terraces_sqm: 65 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-547563 RESIDENTIE HOOST (Heist-aan-Zee) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p34 kelder parking plan (-2/-1) ARTES/B2Ai', png: 'output/test-54756-061-hires/p34.jpg' },
  { name: 'p35 verdieping 2 typical apartment floor (L+02)', png: 'output/test-54756-061-hires/p35.jpg' },
  { name: 'p39 verdieping 6 mid-level apartments (L+06)', png: 'output/test-54756-061-hires/p39.jpg' },
  { name: 'p44 verdieping 11 upper apartments (L+11)', png: 'output/test-54756-061-hires/p44.jpg' },
  { name: 'p46 verdieping 13 top floor (L+13)', png: 'output/test-54756-061-hires/p46.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE HOOST, Maes en Boereboomplein 1, 8301 Heist-aan-Zee.
VBU (Waardebepaling+Brand). AXA Belgium SA. ABEX 1056. Bouwjaar 2025 (nieuwbouw).
Appartementsgebouw. 97 appartementen. Alleenstaand.
16 bouwlagen (-2 t/m 13). 4 liften (Orona hydraulisch) + 1 huishoudlift.
Bebouwde oppervlakte: 1445 m². Architect: ARTES/B2Ai/Caaap.
GVL en V1 zijn casco (verhuurd aan stad Knokke).
2 retail gebouwen apart op terrein zijn NIET opgenomen.
Nieuwbouwwaarde: €57,065,550.

SINGLE BUILDING — 16 levels:

1. KELDER -2 (Niveau -2): 5931.45 m² (80.70 × 73.50)
   - Underground parking + bergingen
   - Much larger footprint than building above (extends under surrounding area)

2. KELDER -1 (Niveau -1): 5931.45 m² (80.70 × 73.50)
   - Underground parking (public) + bergingen
   - Same footprint as Kelder -2

3. GELIJKVLOERS (Niveau 0): 1435 m²
   - Zaal/bibliotheek/café (verhuurd aan stad, casco): 1265 m²
   - Gemene delen appartementen (inkomhallen): 170 m²
   - NO plan included (casco level, no apartment plans available)

4. VERDIEPING 1 (Niveau 1): 1082 m²
   - Kantoren (verhuurd aan stad, casco): 927 m²
   - Gemene delen appartementen (inkomhallen): 155 m²
   - NO plan included (casco level)

5. VERDIEPING 2 (Niveau 2): 1390 m², terrassen 55 m²
   - Binnenruimte (internal courtyard/common area): 330 m²
   - Appartementen/gemene delen: 1060 m²

6. VERDIEPING 3 (Niveau 3): 1137 m², terrassen 52 m²
   - Multifunctionele evenementenruimte: 67 m²
   - Appartementen/gemene delen: 1070 m²

7. VERDIEPING 4 (Niveau 4): 1244 m², terrassen 68 m²
8. VERDIEPING 5 (Niveau 5): 1242 m², terrassen 72 m²
9. VERDIEPING 6 (Niveau 6): 1225 m², terrassen 89 m²
10. VERDIEPING 7 (Niveau 7): 1132 m², terrassen 71 m²
11. VERDIEPING 8 (Niveau 8): 1240 m², terrassen 74 m²
12. VERDIEPING 9 (Niveau 9): 1105 m², terrassen 68 m²
13. VERDIEPING 10 (Niveau 10): 1227 m², terrassen 87 m²
14. VERDIEPING 11 (Niveau 11): 1226 m², terrassen 88 m²
15. VERDIEPING 12 (Niveau 12): 1095 m², terrassen/buiteruimte 224 m²
16. VERDIEPING 13 (Niveau 13): 1003 m², terrassen 65 m²

Total enclosed: 28645.90 m². Total terrassen: 1013 m².

PLAN SHEETS (architect plans by ARTES/B2Ai/Caaap):
- p34 = Kelder plan (BA_KELDER): underground parking for both -2 and -1
  Shows parking spaces, bergingen, technical rooms. 80.70 × 73.50 = 5931.45 m²
- p35 = Verdieping 2 (L+02): typical large apartment floor
  Shows apartments around central courtyard, with terraces. Color-coded legend.
- p39 = Verdieping 6 (L+06): mid-level apartments
  Setback on bottom portion, green terrace area visible
- p44 = Verdieping 11 (L+11): upper level, smaller footprint
  Fewer apartments, more setback
- p46 = Verdieping 13 (L+13): top floor, smallest footprint
  Large terraces, penthouse apartments, spiral staircase visible

NOTE: Levels 0 and 1 are casco (shell) spaces rented to the city of Knokke.
No apartment plans available for these levels. Levels 0-1 have different use
than the residential floors above. Each floor from 2-13 has a unique plan.
The kelder footprint (5931 m²) is much larger than the building above (1445 m²).`;

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

  writeFileSync(`output/test-54756-061-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
