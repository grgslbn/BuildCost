import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Expert data from p1
const EXPERT = {
  buildings: [{
    name: 'Gebouw 1 — August Baesstraat / Lippenslaan',
    total_enclosed_sqm: 1090,
    total_terraces_sqm: 0,
    floors: [
      { level: -1, total_sqm: 290, terraces_sqm: 0 },
      { level: 0, total_sqm: 200, terraces_sqm: 0 },
      { level: 1, total_sqm: 200, terraces_sqm: 0 },
      { level: 2, total_sqm: 200, terraces_sqm: 0 },
      { level: 3, total_sqm: 200, terraces_sqm: 0 },
    ]
  }]
};

// Plan pages: p4(kelder), p5(GV foto), p6(appt niveau 540/560), p2(appt niveau 1070/1120/1335), p3(appt niveau 1600/1865)
// Skip p7 (duplicate of p6), skip p5 (photo of paper, low quality)
const PLAN_PAGES = [4, 5, 6, 2, 3];

const modelId = resolveModel('sonnet');
console.log(`\n=== Testing dossier 54756-1 on sonnet (${modelId}) ===\n`);

const images = PLAN_PAGES.map(p => ({
  name: `p${p}`,
  png: `output/test-54756-1/p${p}.png`
}));

console.log(`Sending ${images.length} images: ${PLAN_PAGES.map(p => 'p'+p).join(', ')}`);

const context = `This is an apartment building at August Baesstraat / Lippenslaan (Knokke-Heist area).
Mixed-use: commercial ground floor (handelsgelijkvloers) + 3 floors of apartments (2 per floor) + basement.
Architect: Marc Jacobs, 04/2002. 1 lift.

CRITICAL — SPLIT-LEVEL APARTMENTS:
This building has split-level apartments. Each "floor" has 2 apartments that span TWO sub-levels connected by an internal staircase.
- Niveau 540/560: 2 apartments (2_1 + 2_2) — these share the SAME footprint as the ground floor (~200m² total incl. common areas)
- Niveau 1070/1120/1335: 2 apartments (3_1 + 4_1) — SAME footprint, ~200m² total. The "mezzanine" is PART OF the apartment, not a separate tiny floor.
- Niveau 1600/1865: apartment 5_1 with mezzanine — SAME footprint, ~200m² total.

Each apartment floor uses the FULL building footprint. Do NOT report 80m² for a floor that should be ~200m².

PAGE GUIDE:
- p4: Kelderverdieping (basement). Contains bergingen 1-8, fietsenstalling, technical rooms, AND corridors/circulation. Measure the OUTER WALLS of the entire basement level — it should be ≥ the ground floor footprint (~200m²+).
- p5: PHOTO of ground floor plan (handelsgelijkvloers). Low quality, perspective distortion — flag low confidence. The commercial space + common areas should total ~200m².
- p6: Apartment floor (niveau 540/560). Has room area labels in m² — READ these directly, do not estimate. Sum room labels per apartment = NET area. Convert: NET / 0.85 = BO. NEVER round down from the BO result.
- p2: LANDSCAPE sheet showing MULTIPLE floor plans (niveaux 1070/1120/1335). These sub-levels belong to the SAME pair of apartments. Combine all rooms across sub-levels for each apartment.
- p3: LANDSCAPE sheet showing MULTIPLE floor plans (niveaux 1600/1865). Same rule: combine sub-levels.

Calibrate scale using door openings (80cm interior).`;

try {
  const result = await extractSqm(images, modelId, { apiKey: API_KEY, context, timeoutMs: 300_000 });

  console.log(`\nDone in ${(result.processingTimeMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`Cost: $${result.costUsd}`);
  console.log(`Images: ${result.imageCount} (${result.imageSizeMb} MB)\n`);

  writeFileSync('output/test-54756-1/result-sonnet.json', JSON.stringify(result, null, 2));

  if (result.extraction) {
    const totals = result.extraction.project_totals || {};
    console.log(`AI total enclosed: ${totals.total_enclosed_sqm || 'N/A'} m²`);
    console.log(`AI total terraces: ${totals.total_terraces_sqm || 'N/A'} m²`);
    console.log(`AI buildings: ${result.extraction.buildings?.length || 0}`);

    if (result.extraction.buildings) {
      for (const b of result.extraction.buildings) {
        console.log(`\n  ${b.name} (${b.type}):`);
        for (const f of b.floors || []) {
          console.log(`    Level ${f.level}: ${f.floor_total_sqm} m² enclosed, ${f.terraces_sqm} m² terraces`);
          for (const z of f.zones || []) {
            console.log(`      ${z.zone_type}: ${z.area_sqm} m² — ${z.measurement || z.description}`);
          }
        }
        const bt = b.building_totals || {};
        console.log(`    TOTAL: ${bt.enclosed_sqm} enclosed, ${bt.terraces_sqm} terraces`);
      }
    }

    // Map split levels to expert levels for comparison
    // The AI might use the actual niveaux or expert-style levels
    const comparison = compareExtraction(result.extraction, EXPERT);
    console.log(`\n--- Comparison vs Expert ---`);
    console.log(formatComparison(comparison));

    // Also show warnings
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
