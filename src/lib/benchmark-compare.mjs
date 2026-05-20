export function compareExtraction(extraction, expertBreakdown) {
  if (!extraction || !expertBreakdown) {
    return { error: 'Missing extraction or expert data', deviations: [] };
  }

  const expertBuildings = expertBreakdown.buildings || [];
  const aiBuildings = extraction.buildings || [];

  const floorDeviations = [];
  let totalExpertEnclosed = 0;
  let totalAiEnclosed = 0;
  let totalExpertTerraces = 0;
  let totalAiTerraces = 0;

  // Match buildings by order (expert and AI should produce same building count)
  const maxBuildings = Math.max(expertBuildings.length, aiBuildings.length);

  for (let bi = 0; bi < maxBuildings; bi++) {
    const expertBldg = expertBuildings[bi];
    const aiBldg = aiBuildings[bi];

    if (!expertBldg || !aiBldg) {
      floorDeviations.push({
        building: bi,
        buildingName: expertBldg?.name || aiBldg?.name || `Building ${bi + 1}`,
        error: expertBldg ? 'AI missing this building' : 'AI found extra building'
      });
      if (expertBldg) {
        totalExpertEnclosed += expertBldg.total_enclosed_sqm || 0;
        totalExpertTerraces += expertBldg.total_terraces_sqm || 0;
      }
      if (aiBldg) {
        const bt = aiBldg.building_totals || {};
        totalAiEnclosed += bt.enclosed_sqm || 0;
        totalAiTerraces += bt.balkons_sqm ?? bt.terraces_sqm ?? 0;
      }
      continue;
    }

    const expertFloors = new Map((expertBldg.floors || []).map(f => [f.level, f]));
    const aiFloors = new Map();
    for (const f of aiBldg.floors || []) {
      if (aiFloors.has(f.level)) {
        const agg = aiFloors.get(f.level);
        agg.floor_total_sqm = (agg.floor_total_sqm || 0) + (f.floor_total_sqm || 0);
        agg.balkons_sqm = (agg.balkons_sqm || 0) + (f.balkons_sqm || 0);
        if (f.terraces_sqm) agg.terraces_sqm = (agg.terraces_sqm || 0) + (f.terraces_sqm || 0);
      } else {
        aiFloors.set(f.level, { ...f });
      }
    }
    const allLevels = new Set([...expertFloors.keys(), ...aiFloors.keys()]);

    for (const level of [...allLevels].sort((a, b) => a - b)) {
      const ef = expertFloors.get(level);
      const af = aiFloors.get(level);

      const expertSqm = ef?.total_sqm || 0;
      const aiSqm = af?.floor_total_sqm || 0;
      const expertTerr = ef?.terraces_sqm || 0;
      const aiTerr = af?.balkons_sqm ?? af?.terraces_sqm ?? 0;

      const enclosedDev = expertSqm > 0
        ? Math.round((aiSqm - expertSqm) / expertSqm * 10000) / 100
        : (aiSqm > 0 ? 100 : 0);

      const terraceDev = expertTerr > 0
        ? Math.round((aiTerr - expertTerr) / expertTerr * 10000) / 100
        : (aiTerr > 0 ? 100 : 0);

      floorDeviations.push({
        building: bi,
        buildingName: expertBldg.name || aiBldg.name || `Building ${bi + 1}`,
        level,
        expertEnclosed: expertSqm,
        aiEnclosed: aiSqm,
        enclosedDevPct: enclosedDev,
        expertTerraces: expertTerr,
        aiTerraces: aiTerr,
        terraceDevPct: terraceDev
      });
    }

    totalExpertEnclosed += expertBldg.total_enclosed_sqm || 0;
    const bt = aiBldg.building_totals || {};
    totalAiEnclosed += bt.enclosed_sqm || 0;
    totalExpertTerraces += expertBldg.total_terraces_sqm || 0;
    totalAiTerraces += bt.balkons_sqm ?? bt.terraces_sqm ?? 0;
  }

  const totalDevPct = totalExpertEnclosed > 0
    ? Math.round((totalAiEnclosed - totalExpertEnclosed) / totalExpertEnclosed * 10000) / 100
    : 0;

  return {
    expertTotalSqm: Math.round(totalExpertEnclosed * 100) / 100,
    extractedTotalSqm: Math.round(totalAiEnclosed * 100) / 100,
    deviationPct: totalDevPct,
    expertTerraces: Math.round(totalExpertTerraces * 100) / 100,
    extractedTerraces: Math.round(totalAiTerraces * 100) / 100,
    floorDeviations,
    buildingCountMatch: expertBuildings.length === aiBuildings.length,
    expertBuildingCount: expertBuildings.length,
    aiBuildingCount: aiBuildings.length
  };
}

export function formatComparison(comparison) {
  const lines = [];
  lines.push(`Total: ${comparison.extractedTotalSqm} m² vs expert ${comparison.expertTotalSqm} m² (${comparison.deviationPct > 0 ? '+' : ''}${comparison.deviationPct}%)`);
  lines.push(`Buildings: ${comparison.aiBuildingCount} AI vs ${comparison.expertBuildingCount} expert`);
  lines.push('');

  let currentBuilding = null;
  for (const fd of comparison.floorDeviations) {
    if (fd.error) {
      lines.push(`  ✗ ${fd.buildingName}: ${fd.error}`);
      continue;
    }
    if (fd.buildingName !== currentBuilding) {
      currentBuilding = fd.buildingName;
      lines.push(`  ${fd.buildingName}:`);
    }
    const icon = Math.abs(fd.enclosedDevPct) < 5 ? '✓' : Math.abs(fd.enclosedDevPct) < 15 ? '≈' : '✗';
    const sign = fd.enclosedDevPct >= 0 ? '+' : '';
    const terrStr = fd.expertTerraces > 0 ? ` | terras: ${fd.aiTerraces} vs ${fd.expertTerraces} (${fd.terraceDevPct > 0 ? '+' : ''}${fd.terraceDevPct}%)` : '';
    lines.push(`    ${icon} Level ${String(fd.level).padStart(2)}: ${String(fd.aiEnclosed).padStart(7)} vs ${String(fd.expertEnclosed).padStart(7)} (${sign}${fd.enclosedDevPct}%)${terrStr}`);
  }

  return lines.join('\n');
}
