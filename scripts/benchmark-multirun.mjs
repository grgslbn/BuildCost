import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolveModel } from '../src/lib/sqm-extractor.mjs';
import { multiRunExtract } from '../src/lib/multi-run-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

const DOSSIERS = {
  murano: {
    label: '25-54756-022 RESIDENTIE MURANO (Bredene)',
    outputDir: 'output/test-54756-022-hires',
    expert: {
      buildings: [{
        name: 'Residentie MURANO',
        total_enclosed_sqm: 3821,
        total_terraces_sqm: 238,
        floors: [
          { level: -1, total_sqm: 1016, terraces_sqm: 0 },
          { level: 0, total_sqm: 1017, terraces_sqm: 0 },
          { level: 1, total_sqm: 301, terraces_sqm: 40 },
          { level: 2, total_sqm: 301, terraces_sqm: 49.5 },
          { level: 3, total_sqm: 301, terraces_sqm: 49.5 },
          { level: 4, total_sqm: 301, terraces_sqm: 49.5 },
          { level: 5, total_sqm: 301, terraces_sqm: 49.5 },
          { level: 6, total_sqm: 283, terraces_sqm: 0 },
        ]
      }]
    },
    images: [
      { name: 'p39 Kelder schaal 1/200',         png: 'output/test-54756-022-hires/p39.jpg' },
      { name: 'p40 Begane grond schaal 1/200',    png: 'output/test-54756-022-hires/p40.jpg' },
      { name: 'p41 1ste verdieping schaal 1/100', png: 'output/test-54756-022-hires/p41.jpg' },
      { name: 'p42 2de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p42.jpg' },
      { name: 'p43 3de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p43.jpg' },
      { name: 'p44 4de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p44.jpg' },
      { name: 'p45 5de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p45.jpg' },
      { name: 'p46 6de verdieping schaal 1/100',  png: 'output/test-54756-022-hires/p46.jpg' },
    ],
    context: `Residentie "MURANO", Kapelstraat 55-61, 8450 Bredene.
VBU (Waardebepaling+Brand). Mixed-use apartment building. ABEX 1056.

BUILDING STRUCTURE — STEPPED BUILDING:
- Level -1: Underground parking garage (full footprint under entire building)
- Level 0: Supermarket (winkelruimte casco) + common areas (inkomhal, lift, trap)
- Levels 1-6: Apartments + common areas
  - Each floor has apartments (SLAAPKAMER, EETPLAATS, KEUKEN, BADKAMER, etc.)
  - Floors 2-5 have TERRAS (balkons) on both sides
  - Floor 1 has dakterras on roof of wider GV below
  - Floor 6 (top) has no balkons — smaller footprint

CRITICAL: This is a STEPPED building. The parking garage and commercial ground floor span
a WIDER footprint than the apartment tower above. Upper apartment floors are SMALLER.
Floor 6 is smaller again. Measure each floor INDEPENDENTLY from its own plan.

MIXED SCALES:
- p39 (kelder) and p40 (GV): schaal 1/200 — calibrate from dimension annotations
- p41-p46 (floors 1-6): schaal 1/100 — calibrate separately from dimension annotations
Each plan has its own scale. Do NOT mix calibrations between different scale plans.`,
  },

  prestige: {
    label: 'Residentie Prestige I (Middelkerke)',
    outputDir: 'output/test-55047',
    expert: {
      buildings: [{
        name: 'Residentie Prestige I',
        total_enclosed_sqm: 2271,
        total_terraces_sqm: 201,
        floors: [
          { level: -1, total_sqm: 280, terraces_sqm: 0 },
          { level: 0, total_sqm: 280, terraces_sqm: 0 },
          { level: 1, total_sqm: 177, terraces_sqm: 15 },
          { level: 2, total_sqm: 177, terraces_sqm: 15 },
          { level: 3, total_sqm: 177, terraces_sqm: 15 },
          { level: 4, total_sqm: 177, terraces_sqm: 15 },
          { level: 5, total_sqm: 177, terraces_sqm: 15 },
          { level: 6, total_sqm: 177, terraces_sqm: 15 },
          { level: 7, total_sqm: 177, terraces_sqm: 15 },
          { level: 8, total_sqm: 177, terraces_sqm: 15 },
          { level: 9, total_sqm: 177, terraces_sqm: 15 },
          { level: 10, total_sqm: 118, terraces_sqm: 66 },
        ]
      }]
    },
    images: [
      { name: 'p2', png: 'output/test-55047/p2.png' },
      { name: 'p3', png: 'output/test-55047/p3.png' },
      { name: 'p4', png: 'output/test-55047/p4.png' },
    ],
    context: `Residentie Prestige I, Leopoldlaan 121, Middelkerke.
Appartementsgebouw: 10 bovengrondse verdiepingen + kelder.

BUILDING STRUCTURE:
- Kelder (-1): privatieve bergingen + parkeergarage. Same footprint as GV.
- Gelijkvloers (0): handelsruimte (commercial) + gemeenschappelijke ruimte (lift, trap, inkom).
- Verdiepingen 1-9: typical floors, 2 apartments per floor + small common area (lift, trap, landing).
- Verdieping 10: 1 penthouse apartment + dakterras. Smaller footprint than typical.

CRITICAL — BUILDING SHAPE:
The residential tower (floors 1-9) is NARROWER than the kelder/GV base. Kelder and GV share the same footprint. The tower above is smaller.

PAGE GUIDE:
- p2: TALL sheet with TWO plans side by side. LEFT = gelijkvloers (ground floor). RIGHT = kelderverdieping (basement). These share the same (wider) footprint.
- p3: TWO plans on one sheet. TOP = typische verdieping (apartment floor, NARROWER tower). BOTTOM = a floor variant with dimension annotations.
- p4: TWO plans on one sheet. TOP = typische verdieping. BOTTOM = 10de verdieping (penthouse).

SCALE CALIBRATION — PER PLAN:
Each plan may be at a DIFFERENT scale. Calibrate INDEPENDENTLY for each plan on each page.
- On p2: use parking space width (2.50m) or door openings (0.80m) to calibrate.
- On p3/p4: use door openings (0.80m) to calibrate.
- DO NOT assume the same pixel-per-meter ratio across different pages.

COMMON AREAS:
- GV: entrance hall + lift + stairs + corridors = ~40 m²
- Typical floors 1-9: lift shaft + stairwell + small landing only = ~8-10 m². Much smaller than GV.`,
  },

  dobbelsteen: {
    label: '25-540112 RESIDENTIE DOBBELSTEEN (Dilbeek)',
    outputDir: 'output/test-54011-hires',
    expert: {
      buildings: [{
        name: 'Residentie Dobbelsteen',
        total_enclosed_sqm: 1446,
        total_terraces_sqm: 51,
        floors: [
          { level: -1, total_sqm: 404, terraces_sqm: 0 },
          { level: 0,  total_sqm: 477, terraces_sqm: 0 },
          { level: 1,  total_sqm: 429, terraces_sqm: 41 },
          { level: 2,  total_sqm: 136, terraces_sqm: 10 },
        ]
      }]
    },
    images: [
      { name: 'p14 kelder detail', png: 'output/test-54011-hires/p14.jpg' },
      { name: 'p11 kelder+gelijkvloers 1:100', png: 'output/test-54011-hires/p11.jpg' },
      { name: 'p8 1e verdieping APP.1 1:50', png: 'output/test-54011-hires/p8.jpg' },
      { name: 'p9 kantoorruimte nivo 1', png: 'output/test-54011-hires/p9.jpg' },
      { name: 'p10 2e verdieping APP.2 1:50', png: 'output/test-54011-hires/p10.jpg' },
    ],
    context: `RESIDENTIE DOBBELSTEEN, Baron R De Vironlaan 130, 1700 Dilbeek.
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

NOTE: p11 shows kelder (left) and gelijkvloers (right) side by side at 1/100. The gelijkvloers is the KBC bankkantoor with many office rooms labeled (Bureau, Vergaderzaal, Loketten, etc.)`,
  },

  wiekevorst: {
    label: '25-540184 Wiekevorst (3 gebouwen)',
    outputDir: 'output/test-54018-hires',
    expert: {
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
    },
    images: [
      { name: 'p6 CED gelijkvloers plan (1/50)', png: 'output/test-54018-hires/p6.jpg' },
      { name: 'p9 architect kelder+GVL+verdieping', png: 'output/test-54018-hires/p9.jpg' },
      { name: 'p10 architect gevels+verdieping', png: 'output/test-54018-hires/p10.jpg' },
    ],
    context: `Morkhovenseweg 35, 2222 Wiekevorst.
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
These plans show a rural property with farm buildings being renovated/rebuilt.`,
  },
};

const NUM_RUNS = parseInt(process.argv.find(a => a.startsWith('--runs='))?.split('=')[1] || '3');
const selectedIds = process.argv.filter(a => !a.startsWith('--') && !a.includes('node') && !a.includes('.mjs'));
const dossierIds = selectedIds.length ? selectedIds : Object.keys(DOSSIERS);

const modelName = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || 'sonnet';
const modelId = resolveModel(modelName);

console.log(`\n${'='.repeat(70)}`);
console.log(`MULTI-RUN BENCHMARK — ${NUM_RUNS} runs per dossier, median extraction`);
console.log(`Model: ${modelName} (${modelId})`);
console.log(`Dossiers: ${dossierIds.join(', ')}`);
console.log(`${'='.repeat(70)}\n`);

const allResults = {};

for (const id of dossierIds) {
  const d = DOSSIERS[id];
  if (!d) {
    console.log(`\n⚠ Unknown dossier: ${id} — skipping\n`);
    continue;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${d.label} — ${NUM_RUNS} runs`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`Images: ${d.images.length} (${d.images.map(i => i.name).join(', ')})`);

  try {
    const result = await multiRunExtract(d.images, modelId, {
      apiKey: API_KEY,
      context: d.context,
      timeoutMs: 300_000,
      thinking: false,
    }, NUM_RUNS);

    mkdirSync(d.outputDir, { recursive: true });
    writeFileSync(`${d.outputDir}/multirun-${modelName}-${NUM_RUNS}x.json`, JSON.stringify(result, null, 2));

    console.log(`\n  Summary: ${result.successfulRuns}/${result.numRuns} runs OK`);
    console.log(`  Total cost: $${result.totalCost}`);
    console.log(`  Total time: ${(result.totalTime / 1000).toFixed(0)}s`);

    if (result.medianExtraction) {
      const totals = result.medianExtraction.project_totals || {};
      console.log(`\n  MEDIAN total enclosed: ${totals.total_enclosed_sqm} m²`);
      console.log(`  MEDIAN total balkons: ${totals.total_balkons_sqm} m²`);

      for (const b of result.medianExtraction.buildings) {
        console.log(`\n    ${b.name}:`);
        for (const f of b.floors) {
          const vals = f._all_values;
          const spreadPct = f._spread_sqm && vals[0] > 0
            ? Math.round(f._spread_sqm / vals[0] * 100)
            : 0;
          const stability = spreadPct === 0 ? '●' : spreadPct < 10 ? '◐' : '○';
          console.log(`      ${stability} Level ${String(f.level).padStart(2)}: median ${f.floor_total_sqm} m² — runs: [${vals.join(', ')}] spread: ${f._spread_sqm} m² (${spreadPct}%)`);
        }
      }

      const comparison = compareExtraction(result.medianExtraction, d.expert);
      console.log(`\n  --- Median vs Expert ---`);
      console.log('  ' + formatComparison(comparison).split('\n').join('\n  '));

      // Also show individual run deviations
      console.log(`\n  --- Individual run deviations ---`);
      for (let i = 0; i < result.runs.length; i++) {
        const run = result.runs[i];
        if (!run.extraction?.buildings) {
          console.log(`    Run ${i + 1}: FAILED`);
          continue;
        }
        const rc = compareExtraction(run.extraction, d.expert);
        console.log(`    Run ${i + 1}: ${rc.deviationPct > 0 ? '+' : ''}${rc.deviationPct}% (${rc.extractedTotalSqm} m²)`);
      }

      allResults[id] = {
        medianDeviation: comparison.deviationPct,
        medianTotal: comparison.extractedTotalSqm,
        expertTotal: comparison.expertTotalSqm,
        runDeviations: result.runs.map(r => {
          if (!r.extraction?.buildings) return null;
          const c = compareExtraction(r.extraction, d.expert);
          return c.deviationPct;
        }),
        spread: result.medianExtraction.buildings.flatMap(b =>
          b.floors.map(f => ({ level: f.level, spread: f._spread_sqm, values: f._all_values }))
        ),
        cost: result.totalCost,
      };
    } else {
      console.log(`\n  ✗ All runs failed to parse!`);
    }
  } catch (err) {
    console.error(`\n  ✗ Fatal error: ${err.message}`);
  }
}

// Final summary
console.log(`\n${'='.repeat(70)}`);
console.log(`MULTI-RUN BENCHMARK SUMMARY`);
console.log(`${'='.repeat(70)}\n`);
console.log(`  ${'Dossier'.padEnd(25)} ${'Median'.padStart(8)} ${'Expert'.padStart(8)} ${'Dev%'.padStart(8)} ${'Runs'.padStart(20)} ${'Cost'.padStart(8)}`);
console.log(`  ${'─'.repeat(77)}`);

let totalCost = 0;
for (const [id, r] of Object.entries(allResults)) {
  const d = DOSSIERS[id];
  const runsStr = r.runDeviations.map(d => d === null ? 'FAIL' : `${d > 0 ? '+' : ''}${d}%`).join(', ');
  console.log(`  ${d.label.slice(0, 25).padEnd(25)} ${String(r.medianTotal).padStart(8)} ${String(r.expertTotal).padStart(8)} ${(r.medianDeviation > 0 ? '+' : '') + r.medianDeviation + '%'} ${runsStr.padStart(20)} $${r.cost}`);
  totalCost += r.cost;
}
console.log(`\n  Total cost: $${Math.round(totalCost * 10000) / 10000}`);
console.log(`  ● = stable (0% spread), ◐ = moderate (<10%), ○ = volatile (≥10%)\n`);
