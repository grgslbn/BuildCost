import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-540184 — Morkhovenseweg 35, 2222 Wiekevorst
// VBN (Brand-Nieuwbouw). 3 gebouwen. BVBA BEYNS PASCAL.
// Architect: Mieke van Herck architecture/interieur.
//
// Expert Berekening (p5):
//   Gebouw A (Woning):
//     Kelder: 129 m², GVL: 159 m², Nivo 1: 125 m², Dakterras: 6 m², Zolder (vide): 87 m²
//     Total enclosed: 500 m², terrassen: 6 m²
//
//   Gebouw B (Woning):
//     Kelder: 72 m², GVL (ingericht 44 + niet-ingericht 34): 78 m², Nivo 1: 34 m²
//     Total enclosed: 184 m², terrassen: 0
//
//   Gebouw C (Atelier/opslagplaats):
//     Kelder: 32 m², GVL: 255 m², Nivo 1: 104 m², Carport: 41 m²
//     Total enclosed: 432 m², terrassen: 0
//
// Grand total enclosed: 1116 m², total terrassen: 6 m²
//
// Notes: Niet vergund loods, paardenstal, grondwerken en buitenaanleg NIET inbegrepen.
const EXPERT = {
  buildings: [
    {
      name: 'Gebouw A Woning',
      total_enclosed_sqm: 500,
      total_terraces_sqm: 6,
      floors: [
        { level: -1, total_sqm: 129, terraces_sqm: 0 },
        { level: 0,  total_sqm: 159, terraces_sqm: 0 },
        { level: 1,  total_sqm: 125, terraces_sqm: 6 },
        { level: 2,  total_sqm: 87,  terraces_sqm: 0 },
      ]
    },
    {
      name: 'Gebouw B Woning',
      total_enclosed_sqm: 184,
      total_terraces_sqm: 0,
      floors: [
        { level: -1, total_sqm: 72, terraces_sqm: 0 },
        { level: 0,  total_sqm: 78, terraces_sqm: 0 },
        { level: 1,  total_sqm: 34, terraces_sqm: 0 },
      ]
    },
    {
      name: 'Gebouw C Atelier',
      total_enclosed_sqm: 432,
      total_terraces_sqm: 0,
      floors: [
        { level: -1, total_sqm: 32,  terraces_sqm: 0 },
        { level: 0,  total_sqm: 296, terraces_sqm: 0 },
        { level: 1,  total_sqm: 104, terraces_sqm: 0 },
      ]
    }
  ]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-540184 Wiekevorst (3 gebouwen) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p6 CED gelijkvloers plan (1/50)', png: 'output/test-54018-hires/p6.jpg' },
  { name: 'p9 architect kelder+GVL+verdieping', png: 'output/test-54018-hires/p9.jpg' },
  { name: 'p10 architect gevels+verdieping', png: 'output/test-54018-hires/p10.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `Morkhovenseweg 35, 2222 Wiekevorst.
VBN (Brand-Nieuwbouw). BVBA BEYNS PASCAL. Baloise Belgium NV.
Architect: Mieke van Herck architecture/interieur.

THREE SEPARATE BUILDINGS on the property:

GEBOUW A — WONING (main dwelling):
- Kelder: 129 m²
- Gelijkvloers: woonkamer, keuken, bureau, sanitair = 159 m²
- Nivo 1 (verdieping): slaapkamers, badkamer = 125 m²
- Dakterras: 6 m²
- Zolder (vide): 87 m²

GEBOUW B — WONING (small secondary dwelling):
- Kelder: 72 m²
- Gelijkvloers: ingericht 44 m² + niet-ingericht 34 m² = 78 m² total
- Nivo 1: 34 m²

GEBOUW C — ATELIER/OPSLAGPLAATS (workshop/storage):
- Kelder: 32 m²
- Gelijkvloers: 255 m²
- Nivo 1: 104 m²
- Carport: 41 m²

PLAN SHEETS:
- p6 = CED expert plan (schaal 1/50) showing gelijkvloers of all 3 buildings:
  A = main woning (center), B = small woning (left, L-shaped), C = atelier/opslagplaats (right, large rectangle)
  Also shows facade views (voorgevel, achtergevel, zijgevels) and fundering/riolering plan
- p9 = Architect plans (Mieke van Herck) showing BESTAANDE TOESTAND + NIEUWE TOESTAND
  Contains kelder plan, gelijkvloers plan, verdieping plan at various scales (1/50, 1/100)
  Also shows facades and construction details
- p10 = Architect plans showing NIEUWE TOESTAND
  Contains colored facade views, gelijkvloers plan, verdieping plans
  Also shows construction details and cross-sections

NOTE: "Niet inbegrepen: niet vergund loods, paardenstal, grondwerken en buitenaanleg."
These plans show a rural property with farm buildings being renovated/rebuilt.`;

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

  writeFileSync(`output/test-54018-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
