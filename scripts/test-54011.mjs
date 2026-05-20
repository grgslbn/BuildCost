import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 25-540112 — RESIDENTIE DOBBELSTEEN, Baron R De Vironlaan 130, 1700 Dilbeek
// VNB (Nieuwbouw), halfopen. ABEX 1056.
// Building met KBC bankkantoor, syndicuskantoor en 2 appartementen.
//
// Expert Berekening (p5):
//   Kelder: 404 m²
//   Gelijkvloers: KBC + Traphal: 477 m²
//   Nivo 1: Appartement + circulatie: 149 m², Kantoorruimte: 280 m², Terrassen: 41 m²
//   Nivo 2: Appartement + circulatie: 136 m², Terrassen: 10 m²
//
// Total enclosed: 404 + 477 + (149+280) + 136 = 1446 m²
// Total terrassen: 41 + 10 = 51 m²
const EXPERT = {
  buildings: [{
    name: 'Residentie Dobbelsteen',
    total_enclosed_sqm: 1446,
    total_terraces_sqm: 51,
    floors: [
      { level: -1, total_sqm: 404, terraces_sqm: 0 },   // kelder (garages, kelders, tellerlokaal)
      { level: 0,  total_sqm: 477, terraces_sqm: 0 },   // KBC bankkantoor + traphal
      { level: 1,  total_sqm: 429, terraces_sqm: 41 },   // appt+circ 149 + kantoorruimte 280
      { level: 2,  total_sqm: 136, terraces_sqm: 10 },   // appt+circ
    ]
  }]
};

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 25-540112 RESIDENTIE DOBBELSTEEN (Dilbeek) on ${modelName} (${modelId}) ===\n`);

const images = [
  { name: 'p14 kelder detail', png: 'output/test-54011-hires/p14.jpg' },
  { name: 'p11 kelder+gelijkvloers 1:100', png: 'output/test-54011-hires/p11.jpg' },
  { name: 'p8 1e verdieping APP.1 1:50', png: 'output/test-54011-hires/p8.jpg' },
  { name: 'p9 kantoorruimte nivo 1', png: 'output/test-54011-hires/p9.jpg' },
  { name: 'p10 2e verdieping APP.2 1:50', png: 'output/test-54011-hires/p10.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `RESIDENTIE DOBBELSTEEN, Baron R De Vironlaan 130, 1700 Dilbeek.
Nieuwbouw (VNB). Halfopen bebouwing. Mixed-use: KBC bankkantoor + syndicuskantoor + 2 appartementen.
ABEX 1056. Liftinstallatie aanwezig. 26 Zonnepanelen + Thuisbatterij.

BUILDING STRUCTURE:
- Niveau -1 (Kelder): Garage 1, Garage 2, Garage 3, Kelder 1-4, Tellerlokaal, Manoeuvreerruimte, parking P1/P2
- Niveau 0 (Gelijkvloers): KBC Bankkantoor (bureaus, vergaderzaal, loketten, backoffice, kluis, sanitair, berging) + Traphal/inkom
- Niveau 1 (1e Verdieping): APP. 1 (keuken, leefruimte, 2 slaapkamers, badkamer, berging, buro) + Atelier/Kantoorruimte (apart groot volume naast het appartement) + Terrassen (groendak + terras)
- Niveau 2 (2e Verdieping): APP. 2 (keuken, leefruimte, slaapkamer 2, bureau, berging) + Terras

PLAN SHEETS:
- p14 = Uitvoeringsplan Kelderverdieping (detail plan of basement level)
- p11 = Kelder + Gelijkvloers combined at 1/100 scale (LEFT = kelder, RIGHT = gelijkvloers bankkantoor)
- p8 = 1e Verdieping at 1/50 scale (APP. 1 apartment)
- p9 = Kantoorruimte at Nivo 1 (large open atelier/kantoor space with IPE 400 beams — same level as APP. 1)
- p10 = 2e Verdieping at 1/50 scale (APP. 2 apartment)

IMPORTANT: Niveau 1 has TWO separate zones on different plan sheets:
1. APP. 1 (on p8) — residential apartment ~149 m²
2. Atelier/Kantoorruimte (on p9) — large open office space ~280 m²
Both are at the same floor level (Nivo 1). Sum them together for niveau 1 total.

NOTE: p11 shows kelder (left) and gelijkvloers (right) side by side at 1/100. The gelijkvloers is the KBC bankkantoor with many office rooms labeled (Bureau, Vergaderzaal, Loketten, etc.)`;

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

  writeFileSync(`output/test-54011-hires/result-${modelName}.json`, JSON.stringify(result, null, 2));

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
