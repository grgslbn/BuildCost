import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

const modelId = resolveModel('sonnet');

const DOSSIERS = [
  {
    name: 'Commercial',
    dir: 'output/benchmark/commercial',
    images: ['p14', 'p15'],
    context: `Commercial building (winkel + burelen + opslag). 3 floors, no basement.
Ground floor: retail space (winkel). Floor 1: retail + offices (burelen). Floor 2: storage (opslag).
Simple rectangular building, no apartments.`,
  },
  {
    name: 'Die Prince',
    dir: 'output/benchmark/die-prince',
    images: ['p36', 'p6', 'p37-left', 'p37-right', 'p38-top-left', 'p38-bottom-left', 'p38-right', 'p39-top-left', 'p39-bottom-left', 'p39-right'],
    context: `Appartementsgebouw "DIE PRINCE", Oostende. 9 bouwlagen + kelder.
Plans have BO annotations per unit (e.g., "app 07A BO 104,3 m²") — READ these directly.
Kelder has NO parking garage — bergingen, technical rooms, fietsberging, afvalberging.
Garages are on the ground floor (not underground).
Floors 1-8: 2 apartments per floor + common areas (kern). Floor 9: 1 duplex penthouse.
p36 = kelder. p6 = situatieplan. p37 = gelijkvloers. p38-p41 = apartment floors.
Each landscape sheet may show LEFT = plan, RIGHT = detail or another floor.`,
  },
  {
    name: 'Dossier 5 (Anna Monica)',
    dir: 'output/benchmark/dossier-5',
    images: ['p17', 'p18', 'p36', 'p37', 'p38', 'p39', 'p40', 'p41'],
    context: `Residentie "Anna Monica". Apartment building with kelder (parkeergarage), 5 above-ground floors.
Has autolift (car elevator) and regular lifts.
Kelder: parkeergarage + bergingen + garages (525 m²).
GV: small — mostly common areas + autoliftschacht.
Floors 1-4: apartments + common areas.
Some floors have dakterrassen (roof terraces) and balcons.`,
  },
];

console.log(`\n${'='.repeat(70)}`);
console.log(`  BENCHMARK: v4e prompt on Sonnet (${modelId})`);
console.log(`${'='.repeat(70)}\n`);

const results = [];
let totalCost = 0;

for (const dossier of DOSSIERS) {
  const expertPath = `${dossier.dir}/expert-breakdown.json`;
  if (!existsSync(expertPath)) {
    console.log(`⚠ ${dossier.name}: no expert-breakdown.json, skipping\n`);
    continue;
  }

  const expert = JSON.parse(readFileSync(expertPath, 'utf-8'));
  const images = dossier.images.map(name => ({
    name,
    png: `${dossier.dir}/pages/${name}.png`
  })).filter(img => existsSync(img.png));

  if (images.length === 0) {
    console.log(`⚠ ${dossier.name}: no images found, skipping\n`);
    continue;
  }

  console.log(`--- ${dossier.name} (${images.length} images) ---`);

  try {
    const result = await extractSqm(images, modelId, {
      apiKey: API_KEY,
      context: dossier.context,
      timeoutMs: 300_000,
    });

    totalCost += result.costUsd;
    const aiTotal = result.extraction?.project_totals?.total_enclosed_sqm || 0;
    const aiTerraces = result.extraction?.project_totals?.total_terraces_sqm || 0;
    const expTotal = expert.total_enclosed_sqm;
    const expTerraces = expert.total_terraces_sqm;
    const dev = expTotal > 0 ? ((aiTotal - expTotal) / expTotal * 100).toFixed(1) : 'N/A';

    console.log(`  AI: ${aiTotal} m² enclosed, ${aiTerraces} m² terraces`);
    console.log(`  Expert: ${expTotal} m² enclosed, ${expTerraces} m² terraces`);
    console.log(`  Deviation: ${dev}%  |  Cost: $${result.costUsd}  |  ${(result.processingTimeMs/1000).toFixed(0)}s`);

    // Per-building comparison
    const comparison = compareExtraction(result.extraction, expert);
    console.log(formatComparison(comparison));

    results.push({
      name: dossier.name,
      aiTotal,
      aiTerraces,
      expTotal,
      expTerraces,
      deviation: parseFloat(dev),
      cost: result.costUsd,
      time: result.processingTimeMs,
    });

    writeFileSync(
      `${dossier.dir}/result-v4e.json`,
      JSON.stringify(result, null, 2)
    );
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
    results.push({ name: dossier.name, error: err.message });
  }

  console.log('');
}

// Summary table
console.log(`\n${'='.repeat(70)}`);
console.log('  SUMMARY');
console.log(`${'='.repeat(70)}`);
console.log(`  ${'Dossier'.padEnd(25)} ${'AI'.padStart(8)} ${'Expert'.padStart(8)} ${'Dev'.padStart(8)} ${'Cost'.padStart(8)}`);
console.log(`  ${'-'.repeat(57)}`);
for (const r of results) {
  if (r.error) {
    console.log(`  ${r.name.padEnd(25)} ERROR: ${r.error}`);
  } else {
    const icon = Math.abs(r.deviation) < 10 ? '✓' : Math.abs(r.deviation) < 20 ? '≈' : '✗';
    console.log(`${icon} ${r.name.padEnd(25)} ${String(r.aiTotal).padStart(8)} ${String(r.expTotal).padStart(8)} ${(r.deviation >= 0 ? '+' : '') + r.deviation + '%'.padStart(7)} $${r.cost.toFixed(3).padStart(7)}`);
  }
}
console.log(`\n  Total API cost: $${totalCost.toFixed(4)}`);
