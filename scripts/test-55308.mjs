import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 26-553086 — VOF ELVEJA BEHEER, Dorp 59, 2288 Bouwel
// VBN (Brand-Nieuwbouw). AXA Belgium. ABEX 1056.
// Boekhoudkantoor/praktijk psycholoog + 2 appartementen (duplex). Halfopen.
// Nieuwbouw. 13 zonnepanelen. 3 warmtepompen. Architect plans at 1:50.
//
// Expert Berekening (p6 — page 3/4 of CED report):
//   Gelijkvloers: Burelen 169 + Berging 4 + Inkom appartementen 18 = 191 m²
//   Nivo 1: Appartementen + circulatie 143 m², Dakterras 44 m²
//   Nivo 2: Appartementen + circulatie 81 m², Zolder 42 m²
//
// Total enclosed: 191 + 143 + 81 + 42 = 457 m²
// Total terrassen: 44 m²
// Nieuwbouwwaarde incl btw: €944.551,50
const EXPERT = {
  buildings: [{
    name: 'Dorp 59',
    total_enclosed_sqm: 457,
    total_terraces_sqm: 44,
    floors: [
      { level: 0, total_sqm: 191, terraces_sqm: 0 },
      { level: 1, total_sqm: 143, terraces_sqm: 44 },
      { level: 2, total_sqm: 123, terraces_sqm: 0 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 26-553086 DORP 59 BOUWEL on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p10-gvl gelijkvloers architect plan (1/50)', png: 'output/test-55308-hires/p10-gvl.jpg' },
  { name: 'p10-v1 verdieping 1 — 2 duplex appartementen (1/50)', png: 'output/test-55308-hires/p10-v1.jpg' },
  { name: 'p10-v2 verdieping 2 — slaapkamers duplex (1/50)', png: 'output/test-55308-hires/p10-v2.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `DORP 59, 2288 Bouwel (Grobbendonk).
VBN (Brand-Nieuwbouw). AXA Belgium. ABEX 1056.
Boekhoudkantoor/praktijk psycholoog + 2 duplex appartementen verhuurd aan derden.
Halfopen bebouwing. Nieuwbouw. 13 zonnepanelen. 3 warmtepompen.
Architect plans at scale 1:50.

SINGLE BUILDING — mixed commercial/residential, 3 levels:

1. GELIJKVLOERS (Niveau 0): 191 m² enclosed
   - Left side: Burelen (kantoor/psycholoog): Gespreksruimte 01/02/03, Sanitair, Berging, Refter, Kantoorruimte, Afvalberging
   - Center: Handelsruimte (Dorp 59 bus 001), Hal, Inkom
   - Right side: Inkomhal appartementen, Gemeenschap. Berging App.
   - Total: Burelen 169 + Berging 4 + Inkom app 18 = 191 m²

2. VERDIEPING 1 (Niveau 1): 143 m² enclosed, Dakterras 44 m²
   - APP 1 duplex (Dorp 59 bus 101): Keuken, Eethoek, Zithoek, Berging/Wasplaats, WC, Hal, Badkamer
   - APP 2 duplex (Dorp 59 bus 102): Keuken, Eethoek, Zithoek, Berging, Slaapkamer 02, Hal
   - Large terraces at rear (top of plan). Plat dak on both sides.

3. VERDIEPING 2 (Niveau 2): 123 m² enclosed (App 81 + Zolder 42)
   - Duplex upper level: Slaapkamer 01, Slaapkamer 02, Hal, Wasplaats, Badkamer
   - Smaller footprint than V1 (setback with terraces + plat dak)
   - Zolder area (hatched on plan) under pitched roof = 42 m²
   - Terraces at rear visible

Total enclosed: 457 m². Total terrassen: 44 m².

PLAN SHEETS (architect plans, scale 1:50):
- p10-gvl = Gelijkvloers floor plan cropped from composite architect sheet
  Shows all ground floor rooms with red boundary lines marking different units
- p10-v1 = Verdieping 1 floor plan showing 2 side-by-side duplex apartments
  TERRAS labeled at top, PLAT DAK on sides
- p10-v2 = Verdieping 2 floor plan showing upper duplex bedrooms
  Smaller footprint, zolder (hatched area) visible at edges

NOTE: Plans are 1:50 scale (larger than typical 1:100). Good dimension annotations.
The building has a pitched roof — V2 has sloped ceiling areas (zolder) that are
still counted in the Berekening at a lower price/m².`;

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

  writeFileSync(`output/test-55308-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
