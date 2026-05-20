import { readFileSync, writeFileSync, cpSync } from 'fs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

const RUNS = parseInt(process.argv[2]) || 3;
const modelName = process.argv[3] || 'sonnet';
const modelId = resolveModel(modelName);
const label = process.argv[4] || 'default';

const images = [
  { name: 'p22 NIVO -1 kelder',   png: 'output/test-48399b-hires/p150-22-fit.jpg' },
  { name: 'p23 GELIJKVLOERS',      png: 'output/test-48399b-hires/p150-23-fit.jpg' },
  { name: 'p24 NIVO 1',            png: 'output/test-48399b-hires/p150-24-fit.jpg' },
  { name: 'p25 NIVO 2',            png: 'output/test-48399b-hires/p150-25-fit.jpg' },
  { name: 'p26 NIVO 3',            png: 'output/test-48399b-hires/p150-26-fit.jpg' },
];

const context = `Hendrik I Lei / J. Van de Vondelstraat.
Appartementsgebouw met commerciële ruimtes op gelijkvloers. Nieuwbouw.
L-vormig gebouw met binnentuin.

BUILDING STRUCTURE:
- 1 gebouw, L-vormig grondplan
- Kelder (Nivo -1): fundering + riolering + kelders
- Gelijkvloers: commerciële ruimtes + bergingen + terrassen + doorrit garages
- Nivo 1: appartementen
- Nivo 2: appartementen (zelfde layout als Nivo 1)
- Nivo 3: appartementen (kleiner — stepped, met terras)`;

const expertCat1 = 1696, expertCat2 = 580, expertCat3 = 17;
const expertTotal = expertCat1 + expertCat2 + expertCat3;

const thinkingEnabled = process.env.THINKING === '1';

console.log(`\n=== Consistency Test: ${label} | ${modelName} (${modelId}) | ${RUNS} runs | thinking=${thinkingEnabled} ===\n`);

const results = [];

for (let i = 1; i <= RUNS; i++) {
  try {
    const result = await extractSqm(images, modelId, {
      apiKey: API_KEY,
      context,
      timeoutMs: 300_000,
      thinking: thinkingEnabled,
      thinkingBudget: thinkingEnabled ? 10000 : undefined
    });

    const t = result.extraction?.project_totals || {};
    const c1 = t.total_cat1_sqm || 0;
    const c2 = t.total_cat2_sqm || 0;
    const c3 = t.total_cat3_sqm || 0;
    const total = c1 + c2 + c3;
    const devPct = ((total - expertTotal) / expertTotal * 100).toFixed(1);
    const cost = result.costUsd;
    const time = (result.processingTimeMs / 1000).toFixed(0);

    results.push({ run: i, c1, c2, c3, total, devPct, cost, time });
    console.log(`  Run ${i}: cat1=${c1} cat2=${c2} cat3=${c3} total=${total} (${devPct}%) — ${time}s $${cost}`);

    // Extract per-floor data for variance analysis
    const floors = result.extraction?.buildings?.[0]?.floors || [];
    const floorStr = floors.map(f => `L${f.level}:${(f.cat1_sqm||0)+(f.cat2_sqm||0)}`).join(' ');
    console.log(`         floors: ${floorStr}`);
  } catch (err) {
    console.log(`  Run ${i}: ERROR — ${err.message}`);
    results.push({ run: i, c1: 0, c2: 0, c3: 0, total: 0, devPct: 'ERR', cost: 0, time: 0 });
  }
}

// Calculate stats
const totals = results.filter(r => r.total > 0).map(r => r.total);
const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
const stddev = Math.sqrt(variance);
const cv = (stddev / mean * 100).toFixed(1);
const min = Math.min(...totals);
const max = Math.max(...totals);
const spread = ((max - min) / mean * 100).toFixed(1);
const totalCost = results.reduce((a, r) => a + (r.cost || 0), 0).toFixed(4);

console.log(`\n--- Summary: ${label} ---`);
console.log(`  Mean: ${mean.toFixed(0)} m² | StdDev: ${stddev.toFixed(0)} | CV: ${cv}%`);
console.log(`  Range: ${min}–${max} m² | Spread: ${spread}%`);
console.log(`  Expert: ${expertTotal} m² | Mean dev: ${((mean - expertTotal) / expertTotal * 100).toFixed(1)}%`);
console.log(`  Cost: $${totalCost} total\n`);
