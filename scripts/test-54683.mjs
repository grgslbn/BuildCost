import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-546832 — CEBIM Rusthuis, Avenue Baron Albert d'Huart 45, 1150 Woluwe-Saint-Pierre
// VBN (Brand-Nieuwbouw). AXA Belgium. ABEX 1056.
// Extension d'une maison de repos "Notre-Dame de Stockel".
// Alleenstaand. Goed onderhouden. 3 liften. Bouwjaar onbekend.
// Building has EXTENSION (curved wing) + EXISTANT (rectangular part).
// 5 levels: Kelder, GVL, Nivo 1-3. Groendak on part of roof.
//
// Expert Berekening (p41 — page 3/8 of CED report):
//   Kelder: 974 m², €2,483,700 (€2,550/m²)
//   Terras + inkomtrap: 140 m², €49,000
//   Buitentrap: €30,000
//   GVL: 950 m², €2,421,225
//   Nivo 1: 950 m², €2,421,225
//   Nivo 2: 806 m², €2,054,025
//   Nivo 3: 383 m², €975,375
//   Groendak: 150 m², €28,500
//   Tuinhuis: €15,000
//   3x Liftinstallaties: €189,000
//   Koelcel + Diepvriescel: €20,000
//   Inpandig hoogspanningscabine: €65,000
//
// Total enclosed: 974 + 950 + 950 + 806 + 383 = 4063 m²
// Total terrassen: 140 + 150 (groendak) = 290 m²
// Nieuwbouwwaarde incl btw: €10,752,050
const EXPERT = {
  buildings: [{
    name: 'Rusthuis Notre-Dame de Stockel',
    total_enclosed_sqm: 4063,
    total_terraces_sqm: 290,
    floors: [
      { level: -1, total_sqm: 974,  terraces_sqm: 0 },
      { level: 0,  total_sqm: 950,  terraces_sqm: 140 },
      { level: 1,  total_sqm: 950,  terraces_sqm: 0 },
      { level: 2,  total_sqm: 806,  terraces_sqm: 0 },
      { level: 3,  total_sqm: 383,  terraces_sqm: 150 },
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-546832 RUSTHUIS STOCKEL (Woluwe-Saint-Pierre) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p42 sous-sol/kelder plan (CED photo)', png: 'output/test-54683-hires/p42.jpg' },
  { name: 'p43 rez-de-chaussee/GVL plan (CED photo)', png: 'output/test-54683-hires/p43.jpg' },
  { name: 'p44 etage +1 plan (CED photo)', png: 'output/test-54683-hires/p44.jpg' },
  { name: 'p45 etage +2 plan (CED photo)', png: 'output/test-54683-hires/p45.jpg' },
  { name: 'p46 etage +3 plan (CED photo)', png: 'output/test-54683-hires/p46.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RUSTHUIS NOTRE-DAME DE STOCKEL, Avenue Baron Albert d'Huart 45, 1150 Woluwe-Saint-Pierre.
VBN (Brand-Nieuwbouw). AXA Belgium. ABEX 1056.
Extension d'une maison de repos (nursing home). Alleenstaand. Goed onderhouden.
3 liftinstallaties. Koelcel + diepvriescel. Inpandig hoogspanningscabine.
Architect: ALTIPLAN. Nieuwbouwwaarde: €10,752,050.

SINGLE BUILDING — 5 levels (kelder to +3), EXTENSION (curved wing) + EXISTANT (rectangular):

1. KELDER (Sous-Sol, Niveau -1): 974 m²
   - Underground level with bergingen, technical rooms
   - Plan label: "PLAN - SOUS-SOL"
   - Extension + Existant combined

2. GVL (Rez-de-Chaussée, Niveau 0): 950 m², terras+inkomtrap 140 m²
   - Main entrance, reception, offices, common areas
   - Plan label: "PLAN - REZ-DE-CHAUSSEE"
   - Extension 567m² + Existant 382.5m² ≈ 950m²

3. NIVO 1 (Etage +1): 950 m²
   - Resident rooms (chambres), nursing stations
   - Plan label: "PLAN - ETAGE +1"
   - Extension + Existant combined

4. NIVO 2 (Etage +2): 806 m²
   - Resident rooms, smaller footprint (setback)
   - Plan label: "PLAN - ETAGE +2"
   - Extension 423m² + Existant 392.5m²

5. NIVO 3 (Etage +3): 383 m², groendak 150 m²
   - Top floor, smallest footprint
   - Groendak (green roof) on lower rooftop areas

Total enclosed: 4063 m². Total terrassen: 290 m² (140 terras + 150 groendak).

NOTE: Plans are PHOTOGRAPHS of physical architect plans taken during site visit.
Quality is lower than scanned plans — shadows and hands visible in photos.
Each plan shows "EXTENSION" area (curved wing) and "EXISTANT" area (original building).
The building is "Extension d'une maison de repos Notre-Dame de Stockel" by ALTIPLAN architect.`;

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

  writeFileSync(`output/test-54683-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
