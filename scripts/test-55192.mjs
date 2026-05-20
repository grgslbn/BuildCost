import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 26-551925 — DE VIERHOEKHOEVE, Brielstraat 46, 9860 Oosterzele
// VBN (Brand-Nieuwbouw), alleenstaand. Geklasseerd gebouw (beschermd onroerend erfgoed).
// Voormalig tehuis voor gehandicapten. ABEX 1056.
//
// Expert Berekening (p6):
//   Kelders (Nivo -1): 448.44 m²
//   GVL (Nivo 0): ateliers, leefruimtes, sanitair, slaapkamers = 1183.70 m²
//   Nivo 1: leefruimtes, gemeenschappelijke ruimtes = 1069.00 m²
//   Nivo 2: zolder/kine ruimte = 448.44 m², zolder casco pastorie = 127.00 m²
//   + Berging (Nivo 0, apart): 32 m²
//   + Fietsenstalling (Nivo 0, apart): 60 m²
//
// Total enclosed (main building): 448.44 + 1183.70 + 1069.00 + 448.44 + 127.00 = 3276.58 m²
// + Berging 32 m² + Fietsenstalling 60 m² (apart, niveau 0)
// Total enclosed (incl outbuildings): 3276.58 + 32 + 60 = 3368.58 m²
// NO terrassen/balkons mentioned.
// NOTE: No kelder plan available. No plan for 127 m² casco pastorie zolder.
const EXPERT = {
  buildings: [{
    name: 'De Vierhoekhoeve',
    total_enclosed_sqm: 3369,
    total_terraces_sqm: 0,
    floors: [
      { level: -1, total_sqm: 448, terraces_sqm: 0 },    // kelders (no plan — same footprint as 2de verdieping)
      { level: 0,  total_sqm: 1276, terraces_sqm: 0 },   // GVL 1183.70 + berging 32 + fietsenstalling 60
      { level: 1,  total_sqm: 1069, terraces_sqm: 0 },   // leefruimtes, gemeenschappelijke ruimtes
      { level: 2,  total_sqm: 576, terraces_sqm: 0 },    // zolder 448.44 + casco pastorie 127
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 26-551925 DE VIERHOEKHOEVE (Oosterzele) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p19 gelijkvloers Deel 1+2 (CED plan)', png: 'output/test-55192-hires/p19.jpg' },
  { name: 'p20 1ste verdieping Deel 1+2 (CED plan)', png: 'output/test-55192-hires/p20.jpg' },
  { name: 'p18 2de verdieping (CED plan)', png: 'output/test-55192-hires/p18.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `DE VIERHOEKHOEVE, Brielstraat 46, 9860 Oosterzele (Gijzenzele).
Voormalig tehuis voor gehandicapten huisvesting / weekend opvang.
Alleenstaand. Geklasseerd gebouw (beschermd onroerend erfgoed). VBN (Brand-Nieuwbouw).
ABEX 1056. Nieuwbouwwaarde €6.596.900 incl BTW. Liftinstallatie aanwezig.

BUILDING STRUCTURE (from Berekening):
- Niveau -1 (Kelders): 448.44 m² — NO PLAN PROVIDED, same footprint as 2de verdieping
- Niveau 0 (Gelijkvloers): ateliers, leefruimtes, sanitair, slaapkamers = 1183.70 m²
- Niveau 1 (1ste verdieping): leefruimtes, gemeenschappelijke ruimtes = 1069 m²
- Niveau 2 (2de verdieping): zolder + kine ruimte = 448.44 m² + zolder casco voormalige pastorie = 127 m²
- Berging (apart, niveau 0): 32 m²
- Fietsenstalling (apart, niveau 0): 60 m²

PLAN SHEETS (CED expert floor plans, Schaal 1/250):
- p19 = Gelijkvloers Deel 1 + Deel 2 — L-shaped plan with per-room m² labels
- p20 = 1ste verdieping Deel 1 + Deel 2 — per-room m² labels
- p18 = 2de verdieping — per-room m² labels, "Totale oppervlakte 2de verdieping: 448,44 m²"

IMPORTANT: These are CED-drawn schematic floor plans with per-room BO area labels (e.g., "141.43 m²", "83.10 m²").
Each room has its area already calculated and displayed as a label.
SUM ALL ROOM LABELS on each floor plan to get the floor total.
The total is also shown on each plan (e.g., "Totale oppervlakte gelijkvloers: 1.183,70 m²").

The building is large and L-shaped. Each floor plan is split into "Deel 1" (left wing) and "Deel 2" (right wing).

NOTE: The kelder (niveau -1) has NO plan sheet. You cannot measure it. The AI should note this.
NOTE: The 127 m² casco pastorie zolder is a separate wing (old pastorie) at niveau 2 — may not appear on the 2de verdieping plan.`;

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

  writeFileSync(`output/test-55192-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
