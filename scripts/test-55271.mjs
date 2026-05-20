import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 26-552710 — RESIDENTIE HAPPY TIMES, Zegemeerpad 4, 8300 Knokke
// VAH (Herbouwwaarde). AXA Belgium SA. ABEX 1056.
// Meergezinsvilla (appartementsgebouw). Alleenstaand. Bouwjaar onbekend.
// 5 niveaus (-1 t/m 3). Lift. Architect: knokimmo.
//
// Expert Berekening (p8 — page 5/5 of CED report):
//   Niveau -1 (Parking/bergingen): 498 m², €1.025/m²
//   Niveau 0 (GVL appartementen/studios): 265 m², €2.990/m²
//   Niveau 1 (appartementen): 265 m², terrassen 82.40 m², €2.990/m²
//   Niveau 2 (appartementen): 254 m², terrassen 64.80 m², €2.989/m²
//   Niveau 3 (Dakopbouw): 35 m², €1.200/m²
//   Lift: €58.000
//
// Total enclosed: 498 + 265 + 265 + 254 + 35 = 1317 m²
// Total terrassen: 82.40 + 64.80 = 147.20 m²
// Nieuwbouwwaarde: €3.086.306
const EXPERT = {
  buildings: [{
    name: 'Residentie Happy Times',
    total_enclosed_sqm: 1317,
    total_terraces_sqm: 147.20,
    floors: [
      { level: -1, total_sqm: 498,  terraces_sqm: 0 },
      { level: 0,  total_sqm: 265,  terraces_sqm: 0 },
      { level: 1,  total_sqm: 265,  terraces_sqm: 82.40 },
      { level: 2,  total_sqm: 254,  terraces_sqm: 64.80 },
      { level: 3,  total_sqm: 35,   terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 26-552710 RESIDENTIE HAPPY TIMES (Knokke) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p9 kelder/parking + gelijkvloers (faded scan)', png: 'output/test-55271-hires/p9.jpg' },
  { name: 'p12 gelijkvloers detailed (units A0/B0/C0 + studio, highlighted)', png: 'output/test-55271-hires/p12.jpg' },
  { name: 'p14 inplantingsplan + verdieping + dakverdieping', png: 'output/test-55271-hires/p14.jpg' },
  { name: 'p13 niveau 2 appartement (single unit detail)', png: 'output/test-55271-hires/p13.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE HAPPY TIMES, Zegemeerpad 4, 8300 Knokke.
VAH (Herbouwwaarde). AXA Belgium SA. ABEX 1056.
Meergezinsvilla (appartementsgebouw). Alleenstaand. Lift.
Architect: knokimmo, Knokke. Nieuwbouwwaarde €3.086.306.

SINGLE BUILDING — 5 levels (-1 to +3):

1. NIVEAU -1 (Kelder/Parking): 498 m²
   Underground parking + bergingen (8 parking spaces)

2. NIVEAU 0 (Gelijkvloers): 265 m²
   Appartementen A0 + B0 (studio) + C0 + gemeenschappelijke hall + traphal + lift

3. NIVEAU 1 (1ste verdieping): 265 m², terrassen 82.40 m²
   Appartementen with terrasses. Same footprint as GVL.

4. NIVEAU 2 (2de verdieping): 254 m², terrassen 64.80 m²
   Appartementen with terrasses. Slightly setback from niveau 1.

5. NIVEAU 3 (Dakopbouw): 35 m²
   Small roof extension (dakopbouw).

Total enclosed: 1317 m². Total terrassen: 147.20 m².

PLAN SHEETS (architect plans by knokimmo):
- p9 = Faded scanned plan showing kelder/parking (top) and gelijkvloers layout (bottom).
  Low quality scan but shows parking spaces and GVL rooms.
- p12 = Detailed gelijkvloers floor plan, highlighted in yellow. Shows units A0, B0 (studio),
  C0 with room labels (LIVING, KEUKEN, SLAAPKAMER, BADKAMER, GEMEENSCHAPPELIJKE HALL,
  TRAPHAL, LIFT). Extensive dimension annotations. NOTE: Plan is rotated/upside down.
- p14 = Composite sheet: Inplantingsplan (top half) + two floor plans (bottom half):
  Left = DAKVERDIEPING (level 3, small dakopbouw ~35 m²)
  Right = VERDIEPING (typical upper floor, shows apartments with room labels)
  Small scale but readable. Architect: knokimmo.
- p13 = Detailed plan of single apartment on niveau 2. Shows SLAAPKAMER 1, SLAAPKAMER 2,
  LIVING, KEUKEN, HALL, WC, BADKAMER, terras. Marked with "2". Good dimensions.

NOTE: The kelder plan (p9) is a faded scan. The GVL plan (p12) is the clearest with
yellow highlights. Upper floors on p14 are small but show the layout. p13 gives detail
for one level 2 apartment but not the complete floor.`;

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

  writeFileSync(`output/test-55271-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
