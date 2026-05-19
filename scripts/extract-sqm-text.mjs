import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/extract-sqm-text.mjs <pdf-path> [output-dir]');
  process.exit(1);
}

const outputDir = process.argv[3] || join('output', basename(pdfPath, '.pdf') + '-text');
mkdirSync(outputDir, { recursive: true });

console.log('\n━━━ SQM Text Extraction Pipeline ━━━');
console.log(`PDF: ${pdfPath}\n`);

const pdfData = new Uint8Array(readFileSync(pdfPath));
const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
const numPages = doc.numPages;

// ── Step 1: Find pages with floor plan content ─────────────────────────
console.log('Step 1: Scanning pages...');

const allPageData = [];
for (let i = 1; i <= numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });

  const items = tc.items.map(item => ({
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
    width: item.width
  }));

  const fullText = items.map(it => it.str).join(' ');
  const grondplanLabels = fullText.match(/GRONDPLAN\s*[+\-]?\s*\d+/gi) || [];
  const hasBO = /\bBO\s+[\d,\.]+/i.test(fullText);
  const hasNO = /\bNO\s+[\d,\.]+/i.test(fullText);

  allPageData.push({
    page: i,
    items,
    fullText,
    pageWidth: viewport.width,
    grondplanLabels,
    isPlanPage: grondplanLabels.length > 0 || (hasBO && (hasNO || grondplanLabels.length > 0))
  });

  if (grondplanLabels.length > 0) {
    console.log(`  ◆ Page ${String(i).padStart(2)}: ${grondplanLabels.join(', ')} | w=${Math.round(viewport.width)}`);
  }
}

const planPages = allPageData.filter(p => p.isPlanPage);
console.log(`\nFound ${planPages.length} plan pages\n`);

// ── Step 2: Position-based floor assignment ─────────────────────────────
console.log('Step 2: Extracting annotations with position-based floor assignment...');

function parseLevel(grondplanStr) {
  const m = grondplanStr.match(/([+\-])\s*(\d+)|(\d+)/);
  if (!m) return null;
  if (m[1] === '-') return -parseInt(m[2]);
  if (m[1] === '+') return parseInt(m[2]);
  return parseInt(m[3] || m[2]);
}

function classifyZone(type) {
  type = type.toLowerCase().replace(/\./g, '');
  if (/^app|^duplex|^studio/.test(type)) return 'residential';
  if (/^garage|^park/.test(type)) return 'parking';
  if (/^berging|^berg/.test(type)) return 'storage';
  if (/^terras|^balkon/.test(type)) return 'terrace';
  if (/^kern|^gemeensch|^gang|^trappenhal|^sas|^inkom|^vestib/.test(type)) return 'circulation';
  if (/^tellerlokaal|^techniek|^stook|^liftput|^lift\b/.test(type)) return 'technical';
  if (/^fiets/.test(type)) return 'bike_storage';
  if (/^afval/.test(type)) return 'other';
  if (/^poets/.test(type)) return 'storage';
  return 'other';
}

// For each plan page, find the GRONDPLAN labels and their x-positions
// Then assign each annotation to the nearest floor plan based on x-coordinate
const floorUnits = new Map(); // level -> units[]

for (const pageData of planPages) {
  const { items, pageWidth, page } = pageData;
  const midX = pageWidth / 2;

  // Find GRONDPLAN labels with level numbers and their x-positions
  const floorLabels = [];
  for (const item of items) {
    const m = item.str.match(/GRONDPLAN\s*([+\-]?\s*\d+)/i);
    if (m) {
      const level = parseLevel(m[1]);
      if (level !== null) {
        floorLabels.push({ level, x: item.x });
      }
    }
  }

  // Deduplicate: keep the leftmost occurrence of each level
  const uniqueByLevel = new Map();
  for (const fl of floorLabels) {
    if (!uniqueByLevel.has(fl.level) || fl.x < uniqueByLevel.get(fl.level).x) {
      uniqueByLevel.set(fl.level, fl);
    }
  }
  const sortedLabels = [...uniqueByLevel.values()].sort((a, b) => a.x - b.x);

  // If two floor labels exist, split at the x of the second label
  let leftFloor, rightFloor, splitX;
  if (sortedLabels.length >= 2) {
    leftFloor = sortedLabels[0].level;
    rightFloor = sortedLabels[1].level;
    splitX = sortedLabels[1].x - 50; // items just left of the second label belong to the first floor
  } else if (sortedLabels.length === 1) {
    leftFloor = sortedLabels[0].level;
    rightFloor = undefined;
    splitX = pageWidth;
  }

  // Strategy: find all "BO xxx" items, then look for the nearest unit label
  // within a tight spatial window. This avoids false matches from joining
  // non-adjacent text items.
  const boAnnotations = [];
  const noAnnotations = [];

  // Index all BO and NO value items
  const boItems = [];
  const noItems = [];
  for (const item of items) {
    const boMatch = item.str.match(/^BO\s+([\d,\.]+)\s*m/i);
    if (boMatch) {
      boItems.push({ ...item, value: parseFloat(boMatch[1].replace(',', '.')) });
    }
    const noMatch = item.str.match(/^NO\s+([\d,\.]+)\s*m/i);
    if (noMatch) {
      noItems.push({ ...item, value: parseFloat(noMatch[1].replace(',', '.')) });
    }
  }

  // For each BO item, find the nearest label within spatial proximity
  const LABEL_RE = /^(app\.?|kern|duplex|terras|garage|berging|fiets\w*|afval\w*|studio|poets\w*)\s*([\d\w/]*)/i;
  const MAX_LABEL_DIST_X = 150;
  const MAX_LABEL_DIST_Y = 25;

  for (const bo of boItems) {
    // Look for unit label near this BO value (typically just above: higher y in PDF coords)
    let bestLabel = null;
    let bestDist = Infinity;

    for (const item of items) {
      if (!LABEL_RE.test(item.str)) continue;
      const dx = Math.abs(item.x - bo.x);
      const dy = item.y - bo.y; // positive = label is above BO value
      if (dx < MAX_LABEL_DIST_X && dy > -5 && dy < MAX_LABEL_DIST_Y) {
        const dist = dx + Math.abs(dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestLabel = item;
        }
      }
    }

    if (bestLabel) {
      const m = bestLabel.str.match(LABEL_RE);
      boAnnotations.push({
        type: m[1].toLowerCase().replace('.', ''),
        id: m[2]?.trim() || '',
        bo: bo.value,
        x: bo.x,
        y: bo.y,
        source: 'BO'
      });
    }
  }

  // For each NO item, find the nearest label
  const NO_LABEL_RE = /^(berging|sas|tellerlokaal\s*\w*|gemeensch\.?\s*gang|gang|trappenhal|fiets\w*|afval\w*|liftput|poets\w*|Kern)\s*([\d/\w-]*)/i;

  for (const no of noItems) {
    let bestLabel = null;
    let bestDist = Infinity;

    for (const item of items) {
      if (!NO_LABEL_RE.test(item.str)) continue;
      const dx = Math.abs(item.x - no.x);
      const dy = item.y - no.y;
      if (dx < MAX_LABEL_DIST_X && dy > -5 && dy < MAX_LABEL_DIST_Y) {
        const dist = dx + Math.abs(dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestLabel = item;
        }
      }
    }

    if (bestLabel) {
      const m = bestLabel.str.match(NO_LABEL_RE);
      noAnnotations.push({
        type: m[1].toLowerCase().trim(),
        id: m[2]?.trim() || '',
        no: no.value,
        x: no.x,
        y: no.y,
        source: 'NO'
      });
    }
  }

  // Assign annotations to floors based on x-position
  const allAnnotations = [...boAnnotations, ...noAnnotations];

  for (const ann of allAnnotations) {
    let level;

    if (leftFloor !== undefined && rightFloor !== undefined) {
      level = ann.x < splitX ? leftFloor : rightFloor;
    } else if (sortedLabels.length === 1) {
      level = sortedLabels[0].level;
    } else {
      // Fallback: infer from unit ID for apartment-type units
      if (/^(app|kern|duplex|studio)/.test(ann.type) && /^\d{2}/.test(ann.id)) {
        level = parseInt(ann.id.substring(0, 2));
      } else {
        level = leftFloor ?? rightFloor ?? -999;
      }
    }

    if (!floorUnits.has(level)) floorUnits.set(level, { units: [], seen: new Set() });
    // Deduplicate: same type+id+value on the same floor = count once
    // (annotations appear in both plan area and legend/index table)
    const dedupeKey = `${ann.type}|${ann.id}|${ann.bo ?? ann.no}`;
    const bucket = floorUnits.get(level);
    if (!bucket.seen.has(dedupeKey)) {
      bucket.seen.add(dedupeKey);
      bucket.units.push({ ...ann, zone: classifyZone(ann.type), page });
    }
  }

  console.log(`  Page ${page}: L=${leftFloor ?? '?'} R=${rightFloor ?? '?'} (split@${Math.round(splitX)}) | ${boAnnotations.length} BO + ${noAnnotations.length} NO annotations`);
}

// ── Step 3: Aggregate into output structure ─────────────────────────────
console.log('\nStep 3: Aggregating...\n');

// Detect project name
const projectName = planPages.map(p => p.fullText).join(' ').match(/DIE\s+PRINCE/i)?.[0] || 'Unknown';
const scaleMatch = planPages[0]?.fullText.match(/1\/(\d+)/);
const scale = scaleMatch ? `1:${scaleMatch[1]}` : 'unknown';

const floors = [];
const sortedLevels = [...floorUnits.keys()].filter(l => l !== -999).sort((a, b) => a - b);

for (const level of sortedLevels) {
  const { units } = floorUnits.get(level);

  // Aggregate by zone type
  const zoneMap = new Map();
  let terraceTotal = 0;

  for (const u of units) {
    const area = u.bo || u.no || 0;
    if (u.zone === 'terrace') {
      terraceTotal += area;
      continue;
    }
    if (!zoneMap.has(u.zone)) zoneMap.set(u.zone, { items: [], total: 0 });
    const entry = zoneMap.get(u.zone);
    entry.items.push(u);
    entry.total += area;
  }

  const zones = [];
  for (const [zoneType, { items, total }] of zoneMap) {
    const desc = items.map(i => `${i.type} ${i.id}`.trim()).join(', ');
    zones.push({
      zone_type: zoneType,
      description: desc,
      area_sqm: Math.round(total * 10) / 10,
      unit_count: items.length
    });
  }

  const floorTotal = zones.reduce((sum, z) => sum + z.area_sqm, 0);

  let label, labelEn;
  if (level < 0) { label = 'Kelder'; labelEn = 'Basement'; }
  else if (level === 0) { label = 'Gelijkvloers'; labelEn = 'Ground floor'; }
  else { label = `Verdieping +${level}`; labelEn = `Floor +${level}`; }

  floors.push({
    level,
    label,
    label_en: labelEn,
    zones,
    floor_total_sqm: Math.round(floorTotal * 10) / 10,
    terraces_sqm: Math.round(terraceTotal * 10) / 10
  });
}

const totalEnclosed = floors.reduce((s, f) => s + f.floor_total_sqm, 0);
const totalTerraces = floors.reduce((s, f) => s + f.terraces_sqm, 0);
const totalUnderground = floors.filter(f => f.level < 0).reduce((s, f) => s + f.floor_total_sqm, 0);
const totalAboveground = floors.filter(f => f.level >= 0).reduce((s, f) => s + f.floor_total_sqm, 0);

const output = {
  project: {
    description: projectName,
    scale,
    scale_confidence: scale !== 'unknown' ? 0.95 : 0.5,
    extraction_method: 'text-layer-BO-parsing'
  },
  buildings: [{
    id: 'B1',
    name: projectName,
    type: 'apartment_block',
    floors,
    building_totals: {
      enclosed_sqm: Math.round(totalEnclosed * 10) / 10,
      terraces_sqm: Math.round(totalTerraces * 10) / 10,
      underground_sqm: Math.round(totalUnderground * 10) / 10,
      aboveground_sqm: Math.round(totalAboveground * 10) / 10
    }
  }],
  project_totals: {
    total_enclosed_sqm: Math.round(totalEnclosed * 10) / 10,
    total_terraces_sqm: Math.round(totalTerraces * 10) / 10,
    total_underground_sqm: Math.round(totalUnderground * 10) / 10,
    total_aboveground_sqm: Math.round(totalAboveground * 10) / 10,
    building_count: 1
  },
  extraction_warnings: []
};

writeFileSync(join(outputDir, 'extraction.json'), JSON.stringify(output, null, 2));

// ── Print results + benchmark ───────────────────────────────────────────
console.log('━━━ Results ━━━\n');
console.log(`Project: ${projectName} (scale: ${scale})`);

for (const floor of floors) {
  const zonesSummary = floor.zones.map(z => `${z.zone_type}:${z.area_sqm}(${z.unit_count})`).join('  ');
  console.log(`  Level ${String(floor.level).padStart(2)}: ${String(floor.floor_total_sqm).padStart(7)} m² + ${String(floor.terraces_sqm).padStart(5)} terras  │ ${zonesSummary}`);
}

console.log(`\n  TOTAL enclosed: ${totalEnclosed.toFixed(1)} m²`);
console.log(`  TOTAL terraces: ${totalTerraces.toFixed(1)} m²`);

// ── Benchmark comparison (DIE PRINCE) ───────────────────────────────────
if (/die.prince/i.test(projectName) || /54207700055/.test(pdfPath)) {
  console.log('\n━━━ Benchmark: DIE PRINCE ━━━\n');

  const ourFloors = new Map(floors.map(f => [f.level, f]));

  const zoneSum = (minLevel, maxLevel, zoneType) =>
    floors.filter(f => f.level >= minLevel && f.level <= maxLevel)
      .reduce((s, f) => s + (f.zones.find(z => z.zone_type === zoneType)?.area_sqm || 0), 0);

  const terraceSum = (minLevel, maxLevel) =>
    floors.filter(f => f.level >= minLevel && f.level <= maxLevel)
      .reduce((s, f) => s + f.terraces_sqm, 0);

  const comparisons = [
    ['Kelder (-1) total',    ourFloors.get(-1)?.floor_total_sqm || 0, 209.0],
    ['GV garages',           zoneSum(0, 0, 'parking'), 101.9],
    ['GV appartementen',     zoneSum(0, 0, 'residential'), 101.9],
    ['GV gemeenschappelijk', zoneSum(0, 0, 'circulation'), 34.6],
    ['Verd 1-8 app.',        zoneSum(1, 8, 'residential'), 1657.6],
    ['Verd 1-8 gemeensch.',  zoneSum(1, 8, 'circulation'), 98.4],
    ['Verd 1-8 terrassen',   terraceSum(1, 8), 193.6],
    ['Verd 9 appartement',   zoneSum(9, 9, 'residential'), 116.1],
    ['TOTAL enclosed',       totalEnclosed, 2590.9],
  ];

  console.log('  ' + 'Component'.padEnd(28) + 'Ours'.padStart(8) + 'Expert'.padStart(8) + '   Diff');
  console.log('  ' + '─'.repeat(56));
  for (const [label, ours, expert] of comparisons) {
    const diff = ours - expert;
    const pct = expert > 0 ? ((diff / expert) * 100).toFixed(0) : 'n/a';
    const marker = Math.abs(diff) < 1 ? '✓' : Math.abs(diff) < expert * 0.05 ? '≈' : '✗';
    const sign = diff >= 0 ? '+' : '';
    console.log(`  ${marker} ${label.padEnd(26)} ${ours.toFixed(1).padStart(8)} ${expert.toFixed(1).padStart(8)}   ${sign}${diff.toFixed(1)} (${pct}%)`);
  }
}

console.log(`\n✓ Saved to ${join(outputDir, 'extraction.json')}`);
