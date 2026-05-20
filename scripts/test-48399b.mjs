import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

// Dossier 23-48399800053 — Hendrik I Lei / J. Van de Vondelstraat
// L-shaped apartment block with commercial on GV, apartments on upper floors.
// Kelder (underground) + GV + Nivo 1 + Nivo 2 + Nivo 3 (stepped top floor).
// GV: commerciële ruimtes (95.5, 106.66, 91.67, 10.4 m²) + bergingen + terrassen + binnentuin.
// Expert: cat1=1696, cat2=580, cat3=17, total=2293 m²

const modelName = process.argv[2] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n=== Testing 23-48399b Hendrik I Lei (${modelName} / ${modelId}) ===\n`);

const images = [
  { name: 'p22 NIVO -1 kelder (origineel)',   png: 'output/test-48399b-hires/p150-22-fit.jpg' },
  { name: 'p23 GELIJKVLOERS (origineel)',      png: 'output/test-48399b-hires/p150-23-fit.jpg' },
  { name: 'p24 NIVO 1 (origineel)',            png: 'output/test-48399b-hires/p150-24-fit.jpg' },
  { name: 'p25 NIVO 2 (origineel)',            png: 'output/test-48399b-hires/p150-25-fit.jpg' },
  { name: 'p26 NIVO 3 (origineel)',            png: 'output/test-48399b-hires/p150-26-fit.jpg' },
];

console.log(`Sending ${images.length} images: ${images.map(i => i.name).join(', ')}`);

const context = `Hendrik I Lei / J. Van de Vondelstraat.
Appartementsgebouw met commerciële ruimtes op gelijkvloers. Nieuwbouw.
L-vormig gebouw met binnentuin.

BUILDING STRUCTURE:
- 1 gebouw, L-vormig grondplan
- Kelder (Nivo -1): fundering + riolering + kelders
- Gelijkvloers: commerciële ruimtes + bergingen + terrassen + doorrit garages
- Nivo 1: appartementen
- Nivo 2: appartementen (zelfde layout als Nivo 1)
- Nivo 3: appartementen (kleiner — stepped, met terras)

PLAN SHEETS:
- p22 = Nivo -1 (kelder, fundering + riolering)
- p23 = Gelijkvloers (commercieel + bergingen + binnentuin)
- p24 = Nivo 1 (appartementen)
- p25 = Nivo 2 (appartementen, zelfde als Nivo 1)
- p26 = Nivo 3 (appartementen, stepped — kleiner footprint, terras zichtbaar)

NOTE: Visible room area annotations on GV plan (commerciële ruimtes: 95.5m², 106.66m², 91.67m², 10.4m²).
Terras 27.7m² visible on Nivo 3 plan.`;

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

  writeFileSync('output/test-48399b-hires/result-sonnet.json', JSON.stringify(result, null, 2));

  if (result.extraction) {
    const totals = result.extraction.project_totals || {};
    console.log(`AI total CAT1 (livable):     ${totals.total_cat1_sqm ?? 'N/A'} m²`);
    console.log(`AI total CAT2 (non-livable): ${totals.total_cat2_sqm ?? 'N/A'} m²`);
    console.log(`AI total CAT3 (outdoor):     ${totals.total_cat3_sqm ?? 'N/A'} m²`);
    console.log(`AI buildings: ${result.extraction.buildings?.length || 0}`);

    // Expert comparison
    const expertCat1 = 1696, expertCat2 = 580, expertCat3 = 17;
    const aiCat1 = totals.total_cat1_sqm || 0;
    const aiCat2 = totals.total_cat2_sqm || 0;
    const aiCat3 = totals.total_cat3_sqm || 0;
    const devCat1 = ((aiCat1 - expertCat1) / expertCat1 * 100).toFixed(1);
    const devCat2 = ((aiCat2 - expertCat2) / expertCat2 * 100).toFixed(1);
    const devCat3 = expertCat3 > 0 ? ((aiCat3 - expertCat3) / expertCat3 * 100).toFixed(1) : 'N/A';
    console.log(`\n--- Expert comparison ---`);
    console.log(`CAT1: AI ${aiCat1} vs Expert ${expertCat1} → ${devCat1}%`);
    console.log(`CAT2: AI ${aiCat2} vs Expert ${expertCat2} → ${devCat2}%`);
    console.log(`CAT3: AI ${aiCat3} vs Expert ${expertCat3} → ${devCat3}%`);
    console.log(`TOTAL: AI ${aiCat1+aiCat2+aiCat3} vs Expert ${expertCat1+expertCat2+expertCat3} → ${(((aiCat1+aiCat2+aiCat3)-(expertCat1+expertCat2+expertCat3))/(expertCat1+expertCat2+expertCat3)*100).toFixed(1)}%`);

    if (result.extraction.buildings) {
      for (const b of result.extraction.buildings) {
        console.log(`\n  ${b.name} (${b.type}):`);
        for (const f of b.floors || []) {
          const c1 = f.cat1_sqm ?? 0;
          const c2 = f.cat2_sqm ?? 0;
          const c3 = f.cat3_sqm ?? 0;
          const parts = [];
          if (c1) parts.push(`cat1:${c1}`);
          if (c2) parts.push(`cat2:${c2}`);
          if (c3) parts.push(`cat3:${c3}`);
          console.log(`    Level ${f.level}: ${parts.join(' + ')} = ${c1+c2} enclosed — ${f.measurement || ''}`);
          if (f.contents) console.log(`      Contents: ${f.contents}`);
        }
        const bt = b.building_totals || {};
        console.log(`    TOTAL: cat1=${bt.cat1_sqm}, cat2=${bt.cat2_sqm}, cat3=${bt.cat3_sqm}`);
      }
    }

    if (result.extraction.extraction_warnings?.length) {
      console.log('\nWarnings:');
      result.extraction.extraction_warnings.forEach(w => console.log('  -', w));
    }
  } else {
    console.log('PARSE FAILED — raw response:');
    console.log(result.rawText?.slice(0, 500));
  }
} catch (err) {
  console.error('Error:', err.message);
}
