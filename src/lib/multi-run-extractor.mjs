import { extractSqm } from './sqm-extractor.mjs';

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function spread(arr) {
  if (arr.length < 2) return 0;
  return Math.max(...arr) - Math.min(...arr);
}

function buildMedianExtraction(runs) {
  const successfulRuns = runs.filter(r => r.extraction?.buildings);
  if (!successfulRuns.length) return null;

  const buildingCount = median(successfulRuns.map(r => r.extraction.buildings.length));
  const numBuildings = Math.round(buildingCount);

  const medianBuildings = [];

  for (let bi = 0; bi < numBuildings; bi++) {
    const runsWithBuilding = successfulRuns.filter(r => r.extraction.buildings[bi]);
    if (!runsWithBuilding.length) continue;

    const refBuilding = runsWithBuilding[0].extraction.buildings[bi];

    const allLevels = new Set();
    for (const run of runsWithBuilding) {
      for (const f of run.extraction.buildings[bi].floors || []) {
        allLevels.add(f.level);
      }
    }

    const medianFloors = [];
    let totalEnclosed = 0;
    let totalBalkons = 0;

    for (const level of [...allLevels].sort((a, b) => a - b)) {
      const floorValues = [];
      const balkonValues = [];
      let refFloor = null;

      for (const run of runsWithBuilding) {
        const floor = (run.extraction.buildings[bi].floors || []).find(f => f.level === level);
        if (floor) {
          floorValues.push(floor.floor_total_sqm || 0);
          balkonValues.push(floor.balkons_sqm ?? floor.terraces_sqm ?? 0);
          if (!refFloor) refFloor = floor;
        }
      }

      const medSqm = Math.round(median(floorValues));
      const medBalkons = Math.round(median(balkonValues));

      medianFloors.push({
        level,
        floor_total_sqm: medSqm,
        balkons_sqm: medBalkons,
        measurement: `median of ${floorValues.length} runs: [${floorValues.join(', ')}] → ${medSqm}`,
        contents: refFloor?.contents || '',
        _spread_sqm: spread(floorValues),
        _spread_balkons: spread(balkonValues),
        _all_values: floorValues,
        _all_balkons: balkonValues,
      });

      totalEnclosed += medSqm;
      totalBalkons += medBalkons;
    }

    medianBuildings.push({
      name: refBuilding.name,
      type: refBuilding.type,
      floors: medianFloors,
      building_totals: {
        enclosed_sqm: totalEnclosed,
        balkons_sqm: totalBalkons,
      }
    });
  }

  let projectEnclosed = 0;
  let projectBalkons = 0;
  for (const b of medianBuildings) {
    projectEnclosed += b.building_totals.enclosed_sqm;
    projectBalkons += b.building_totals.balkons_sqm;
  }

  return {
    buildings: medianBuildings,
    project_totals: {
      total_enclosed_sqm: projectEnclosed,
      total_balkons_sqm: projectBalkons,
    },
    extraction_warnings: ['Multi-run median extraction — individual run variance shown per floor'],
  };
}

export async function multiRunExtract(images, modelId, opts = {}, numRuns = 3) {
  const runs = [];
  let totalCost = 0;
  let totalTime = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < numRuns; i++) {
    const runLabel = `Run ${i + 1}/${numRuns}`;
    try {
      console.log(`\n  ${runLabel}: starting...`);
      const result = await extractSqm(images, modelId, opts);
      runs.push(result);

      totalCost += result.costUsd;
      totalTime += result.processingTimeMs;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      const totals = result.extraction?.project_totals || {};
      const enclosed = totals.total_enclosed_sqm ?? 'PARSE_FAIL';
      console.log(`  ${runLabel}: done in ${(result.processingTimeMs / 1000).toFixed(1)}s — ${enclosed} m² enclosed`);
    } catch (err) {
      console.log(`  ${runLabel}: ERROR — ${err.message}`);
      runs.push({ error: err.message, extraction: null });
    }
  }

  const medianExtraction = buildMedianExtraction(runs);

  return {
    medianExtraction,
    runs,
    numRuns,
    successfulRuns: runs.filter(r => r.extraction?.buildings).length,
    totalCost: Math.round(totalCost * 10000) / 10000,
    totalTime,
    totalInputTokens,
    totalOutputTokens,
    imageCount: runs[0]?.imageCount || images.length,
    imageSizeMb: runs[0]?.imageSizeMb || 0,
  };
}
