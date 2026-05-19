import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const COL_OMSCHRIJVING = 50;
const COL_NIVEAU = 119;
const COL_OPP = 400;
const COL_WAARDE = 460;

const HEADER_RE = /omschrijving/i;
const TOTAAL_RE = /^totaal\b/i;
const VETUSTEIT_RE = /^vetusteit\b/i;
const ONROERENDE_RE = /^onroerende inrichting/i;
const SECTION_RE = /^(berekening|detaillering)/i;

function parseDecimal(str) {
  if (!str) return null;
  const cleaned = str.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseNiveau(str) {
  if (!str) return null;
  const range = str.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return { from: parseInt(range[1]), to: parseInt(range[2]) };
  const neg = str.match(/^-(\d+)$/);
  if (neg) return { from: -parseInt(neg[1]), to: -parseInt(neg[1]) };
  const single = parseInt(str);
  if (!isNaN(single)) return { from: single, to: single };
  return null;
}

function getItemsNearX(rowItems, targetX, tolerance = 40) {
  return rowItems.filter(it => Math.abs(it.x - targetX) < tolerance);
}

export async function findExpertPages(pdfPath) {
  const pdfData = new Uint8Array(readFileSync(pdfPath));
  const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
  const expertPages = [];
  const seen = new Set();

  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => it.str).join(' ');

      if (/omschrijving.*niveau.*opp\/inhoud/i.test(text) ||
          /berekening.*omschrijving.*opp/i.test(text) ||
          /detaillering.*heropbouwwaarde/i.test(text)) {

        const items = tc.items.map(it => ({
          str: it.str.trim(),
          x: Math.round(it.transform[4]),
          y: Math.round(it.transform[5])
        })).filter(it => it.str.length > 0);

        const sig = items
          .filter(it => /€\s*[\d\.,]+/.test(it.str))
          .map(it => it.str)
          .sort()
          .join('|');

        if (!seen.has(sig)) {
          seen.add(sig);
          expertPages.push({ pageNum: i, items });
        }
      }
    } catch (e) {
      // skip corrupt pages
    }
  }
  return { doc, expertPages };
}

export function extractExpertTable(items) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  // Pass 1: group into rows
  const rows = [];
  let currentRow = [];
  let currentY = items[0]?.y;

  for (const item of items) {
    if (Math.abs(item.y - currentY) > 4) {
      if (currentRow.length) rows.push({ y: currentY, items: currentRow });
      currentRow = [];
      currentY = item.y;
    }
    currentRow.push(item);
  }
  if (currentRow.length) rows.push({ y: currentY, items: currentRow });

  // Pass 2: classify each row
  const classified = rows.map(row => {
    const leftItems = getItemsNearX(row.items, COL_OMSCHRIJVING, 30);
    const leftText = leftItems.map(it => it.str).join(' ').trim();
    const niveauItems = getItemsNearX(row.items, COL_NIVEAU, 30);
    const oppItems = row.items.filter(it => it.x >= COL_OPP && it.x < COL_WAARDE);
    const waardeItems = row.items.filter(it => it.x >= COL_WAARDE);

    const niveauText = niveauItems.map(it => it.str).join('').trim();
    const oppText = oppItems.map(it => it.str).join('').trim();
    const waardeText = waardeItems.map(it => it.str).join(' ').trim();
    const opp = parseDecimal(oppText);
    const niveau = parseNiveau(niveauText);

    let type = 'unknown';
    if (HEADER_RE.test(leftText) && row.items.some(it => /niveau/i.test(it.str))) {
      type = 'header';
    } else if (ONROERENDE_RE.test(leftText)) {
      type = 'infra_header';
    } else if (!leftText && row.items.some(it => /breedte/i.test(it.str)) &&
               row.items.some(it => /waarde/i.test(it.str))) {
      // Alternative infra header: "Breedte Lengte Hoogte Opp/inhoud €/m² Waarde"
      type = 'infra_header';
    } else if (TOTAAL_RE.test(leftText) || VETUSTEIT_RE.test(leftText)) {
      type = 'skip';
    } else if (opp !== null && niveau !== null) {
      type = 'data';
    } else if (leftText && !oppText && !niveauText && !waardeText) {
      type = 'desc';
    } else if (leftText && row.items.some(it => /€/.test(it.str))) {
      type = 'infra_line';
    }

    return { ...row, type, leftText, niveauText, opp, niveau, waardeText };
  });

  // Pass 3: for each data row, collect desc rows between it and the previous data/header row
  const buildings = [];
  let currentBuilding = null;
  let inInfra = false;

  for (let i = 0; i < classified.length; i++) {
    const row = classified[i];

    if (row.type === 'header') {
      if (currentBuilding) buildings.push(currentBuilding);

      let buildingName = null;
      const prevRows = classified.filter(r => r.y > row.y && r.y < row.y + 60);
      for (const pr of prevRows) {
        const txt = pr.items.map(it => it.str).join(' ').trim();
        if (txt && !SECTION_RE.test(txt) && !TOTAAL_RE.test(txt) &&
            !/^\d/.test(txt) && !/€/.test(txt) && txt.length > 3) {
          buildingName = txt;
          break;
        }
      }

      currentBuilding = { name: buildingName || 'Unknown', lines: [], infrastructure: [] };
      inInfra = false;
      continue;
    }

    if (!currentBuilding) continue;

    if (row.type === 'infra_header') {
      inInfra = true;
      continue;
    }

    if (row.type === 'skip') continue;

    if (inInfra) {
      // Infrastructure items can have Opp/inhoud too (e.g., fietsenstalling 17m²)
      if (row.opp !== null && row.leftText) {
        currentBuilding.infrastructure.push({
          description: row.leftText,
          sqm: row.opp,
          waarde: parseDecimal(row.waardeText)
        });
        continue;
      }
      if (row.type === 'infra_line' || (row.leftText && row.items.some(it => /€/.test(it.str)))) {
        const lastEuro = row.items.filter(it => /€/.test(it.str)).pop();
        const waarde = lastEuro ? parseDecimal(lastEuro.str) : null;
        const oppInfra = row.items.filter(it => it.x >= 330 && it.x < 400);
        const sqm = oppInfra.length ? parseDecimal(oppInfra[0].str) : null;
        currentBuilding.infrastructure.push({ description: row.leftText, sqm, waarde });
        continue;
      }
      continue;
    }

    if (row.type === 'data') {
      // Collect ALL desc rows between previous boundary (data/header/infra_header/skip)
      // and this data row — look backward and collect until a non-desc row
      const descParts = [];
      for (let j = i - 1; j >= 0; j--) {
        if (classified[j].type === 'desc') {
          descParts.unshift(classified[j].leftText);
        } else {
          break;
        }
      }
      if (row.leftText) descParts.push(row.leftText);

      // Also collect desc rows AFTER this data row (multi-line wrap below data)
      for (let j = i + 1; j < classified.length; j++) {
        if (classified[j].type === 'desc') {
          // Only collect if Y is close to this row (within 15px = same table row wrap)
          if (row.y - classified[j].y < 15) {
            descParts.push(classified[j].leftText);
            classified[j].type = 'consumed';
          } else {
            break;
          }
        } else {
          break;
        }
      }

      const fullDesc = descParts.join(' ').trim() || '(onbekend)';

      currentBuilding.lines.push({
        description: fullDesc,
        niveau: row.niveau,
        sqm: row.opp,
        waarde: parseDecimal(row.waardeText)
      });
    }
  }

  if (currentBuilding) buildings.push(currentBuilding);
  return buildings.filter(b => b.lines.length > 0);
}

export function buildExpertBreakdown(buildings) {
  const result = {
    buildings: [],
    total_enclosed_sqm: 0,
    total_terraces_sqm: 0
  };

  for (const bldg of buildings) {
    const floorsMap = new Map();
    let buildingEnclosed = 0;
    let buildingTerraces = 0;

    for (const line of bldg.lines) {
      const isTerrace = /terras|balkon|dakterras/i.test(line.description);
      const niv = line.niveau || { from: 0, to: 0 };

      for (let level = niv.from; level <= niv.to; level++) {
        if (!floorsMap.has(level)) {
          floorsMap.set(level, { level, total_sqm: 0, terraces_sqm: 0, lines: [] });
        }
        const floor = floorsMap.get(level);
        const perFloorSqm = line.sqm / (niv.to - niv.from + 1);

        if (isTerrace) {
          floor.terraces_sqm += perFloorSqm;
          buildingTerraces += perFloorSqm;
        } else {
          floor.total_sqm += perFloorSqm;
          buildingEnclosed += perFloorSqm;
        }
        floor.lines.push({
          description: line.description,
          sqm: Math.round(perFloorSqm * 100) / 100
        });
      }
    }

    const floors = [...floorsMap.values()].sort((a, b) => a.level - b.level);
    for (const f of floors) {
      f.total_sqm = Math.round(f.total_sqm * 100) / 100;
      f.terraces_sqm = Math.round(f.terraces_sqm * 100) / 100;
    }

    result.buildings.push({
      name: bldg.name,
      floors,
      infrastructure: bldg.infrastructure,
      total_enclosed_sqm: Math.round(buildingEnclosed * 100) / 100,
      total_terraces_sqm: Math.round(buildingTerraces * 100) / 100
    });

    result.total_enclosed_sqm += buildingEnclosed;
    result.total_terraces_sqm += buildingTerraces;
  }

  result.total_enclosed_sqm = Math.round(result.total_enclosed_sqm * 100) / 100;
  result.total_terraces_sqm = Math.round(result.total_terraces_sqm * 100) / 100;
  return result;
}

// CLI mode
if (process.argv[1]?.includes('expert-extractor')) {
  const pdfPath = process.argv[2];
  if (!pdfPath) { console.error('Usage: node src/lib/expert-extractor.mjs <pdf>'); process.exit(1); }

  const { expertPages } = await findExpertPages(pdfPath);
  console.log(`Found ${expertPages.length} expert page(s)\n`);

  let allBuildings = [];
  for (const ep of expertPages) {
    const buildings = extractExpertTable(ep.items);
    console.log(`Page ${ep.pageNum}: ${buildings.length} building(s)`);
    for (const b of buildings) {
      console.log(`  "${b.name}" — ${b.lines.length} lines, ${b.infrastructure.length} infra`);
      for (const l of b.lines) {
        const niv = l.niveau ? `${l.niveau.from === l.niveau.to ? l.niveau.from : `${l.niveau.from}-${l.niveau.to}`}` : '?';
        console.log(`    [${niv}] ${l.description}: ${l.sqm} m²`);
      }
    }
    allBuildings.push(...buildings);
  }

  const breakdown = buildExpertBreakdown(allBuildings);
  console.log('\n━━━ Expert Breakdown ━━━\n');
  console.log(JSON.stringify(breakdown, null, 2));
}
