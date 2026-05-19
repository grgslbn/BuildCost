import { readFileSync, writeFileSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

const FLOORS = [
  { page: 6, level: -1, label: 'Kelder (parkeergarage)', expertSqm: 1016, expertTerr: 0 },
  { page: 7, level: 0, label: 'Begane grond (supermarkt)', expertSqm: 1017, expertTerr: 0 },
  { page: 8, level: 1, label: '1ste verdieping (appartementen)', expertSqm: 301, expertTerr: 40 },
  { page: 9, level: 2, label: '2de verdieping', expertSqm: 301, expertTerr: 49.5 },
  { page: 10, level: 3, label: '3de verdieping', expertSqm: 301, expertTerr: 49.5 },
  { page: 11, level: 4, label: '4de verdieping', expertSqm: 301, expertTerr: 49.5 },
  { page: 12, level: 5, label: '5de verdieping', expertSqm: 301, expertTerr: 49.5 },
  { page: 13, level: 6, label: '6de verdieping', expertSqm: 283, expertTerr: 0 },
];

const modelId = resolveModel('sonnet');
console.log(`\n=== Per-floor extraction: Residentie MURANO ===\n`);

let totalAi = 0, totalExpert = 0, totalCost = 0;

for (const floor of FLOORS) {
  const images = [{ name: `p${floor.page}`, png: `output/test-54756/p${floor.page}.png` }];

  const context = `This is ONE floor plan of Residentie "MURANO", Kapelstraat 55-61, 8450 Bredene.
This image shows: Level ${floor.level} — ${floor.label}.
This is a SINGLE floor. Extract the area for THIS floor only.
The building is a "trapvormig" (stepped) design — upper floors are SMALLER than the ground floor.
Images rendered at 300 DPI from PDF. Plans marked "schaal 1:200" → 59 pixels = 1 meter.
Calibrate using door openings (80cm) visible on the plan to verify this.`;

  try {
    const result = await extractSqm(images, modelId, { apiKey: API_KEY, context, timeoutMs: 120_000 });

    const b = result.extraction?.buildings?.[0];
    const f = b?.floors?.[0];
    const enclosed = f?.floor_total_sqm || 0;
    const terraces = f?.terraces_sqm || 0;
    const dev = floor.expertSqm > 0 ? Math.round((enclosed - floor.expertSqm) / floor.expertSqm * 100) : 0;

    totalAi += enclosed;
    totalExpert += floor.expertSqm;
    totalCost += result.costUsd;

    const icon = Math.abs(dev) < 10 ? '✓' : Math.abs(dev) < 20 ? '≈' : '✗';
    console.log(`${icon} Level ${String(floor.level).padStart(2)}: AI ${String(enclosed).padStart(6)} vs expert ${String(floor.expertSqm).padStart(6)} (${dev >= 0 ? '+' : ''}${dev}%) | terr: ${terraces} vs ${floor.expertTerr} | $${result.costUsd} ${result.processingTimeMs/1000|0}s`);

    // Show zones
    for (const z of f?.zones || []) {
      console.log(`         ${z.zone_type}: ${z.area_sqm} m² — ${z.measurement || z.description}`);
    }

    writeFileSync(`output/test-54756/floor-${floor.level}-result.json`, JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(`✗ Level ${floor.level}: ERROR — ${err.message}`);
  }
}

const totalDev = Math.round((totalAi - totalExpert) / totalExpert * 100);
console.log(`\n=== TOTAL: AI ${totalAi} vs expert ${totalExpert} (${totalDev >= 0 ? '+' : ''}${totalDev}%) | Cost: $${totalCost.toFixed(4)} ===`);
