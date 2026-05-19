#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { classifyPages } from '../src/lib/pdf-classifier.mjs';
import { renderPlanImages } from '../src/lib/plan-renderer.mjs';
import { extractSqm, resolveModel } from '../src/lib/sqm-extractor.mjs';
import { findExpertPages, extractExpertTable, buildExpertBreakdown } from '../src/lib/expert-extractor.mjs';
import { compareExtraction, formatComparison } from '../src/lib/benchmark-compare.mjs';

// ── Config ──────────────────────────────────────────────────────────────

const DOSSIER_DIR = String.raw`C:\Users\tieme\Mijn Drive\M²Value\field\SELECTION\selectie building`;

const DOSSIERS = [
  { file: '25-54024300042VerzamelPDF_20260501_0930.pdf', label: 'Herentals' },
  { file: '25-54207700055VerzamelPDF_20260501_0231.pdf', label: 'DIE PRINCE' },
  { file: '25-54204200049VerzamelPDF_20260501_0239.pdf', label: 'Commercial' },
  { file: '24-51940600064VerzamelPDF_20260504_2250.pdf', label: '2-Buildings' },
  { file: '26-55079500033VerzamelPDF_20260429_0019.pdf', label: 'Dossier-5' },
];

const ALL_MODELS = ['haiku', 'sonnet', 'opus'];

// ── CLI args ────────────────────────────────────────────────────────────

function parseArgs() {
  const args = { models: ALL_MODELS, dossierIndices: null, outputDir: 'output/benchmark', skipExpert: false, dryRun: false, maxImages: 15 };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--models=')) {
      args.models = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--dossiers=')) {
      const val = arg.split('=')[1];
      if (val !== 'all') {
        args.dossierIndices = val.split(',').map(s => parseInt(s.trim()) - 1);
      }
    } else if (arg.startsWith('--output=')) {
      args.outputDir = arg.split('=')[1];
    } else if (arg.startsWith('--max-images=')) {
      args.maxImages = parseInt(arg.split('=')[1]);
    } else if (arg === '--skip-expert') {
      args.skipExpert = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Benchmark Pipeline — Run AI extraction across dossiers and models

Usage:
  node scripts/benchmark-pipeline.mjs [options]

Options:
  --models=haiku,sonnet,opus   Models to test (default: all three)
  --dossiers=1,2,3             Dossier indices 1-${DOSSIERS.length} (default: all)
  --output=dir                 Output directory (default: output/benchmark)
  --max-images=N               Max plan images per dossier (default: 15)
  --skip-expert                Skip expert extraction (use cached)
  --dry-run                    Classify + render only, no API calls
  -h, --help                   Show this help

Dossiers:
${DOSSIERS.map((d, i) => `  ${i + 1}. ${d.label} (${d.file})`).join('\n')}
`);
      process.exit(0);
    }
  }

  return args;
}

// ── Env loading ─────────────────────────────────────────────────────────

function loadEnv() {
  // Walk up from CWD to find .env.local (handles worktree case)
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const envPath = join(dir, '.env.local');
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
      }
      return envPath;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmt(n) { return (n == null || n === '-' || isNaN(n)) ? '-' : String(Math.round(n * 100) / 100); }
function fmtPct(n) { return n == null ? '-' : `${n >= 0 ? '+' : ''}${n}%`; }
function fmtCost(n) { return n == null ? '-' : `$${n.toFixed(4)}`; }
function fmtTime(ms) { return ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`; }

function pad(s, n) { return String(s).padStart(n); }

// ── Stage 1: Expert extraction ──────────────────────────────────────────

async function extractExpert(pdfPath, cacheDir) {
  const cachePath = join(cacheDir, 'expert-breakdown.json');
  if (existsSync(cachePath)) {
    console.log('    ↩ Using cached expert breakdown');
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  console.log('    Scanning for expert pages...');
  const { expertPages } = await findExpertPages(pdfPath);

  if (expertPages.length === 0) {
    console.log('    ⚠ No expert pages found');
    return null;
  }

  console.log(`    Found ${expertPages.length} expert page(s)`);
  let allBuildings = [];
  for (const ep of expertPages) {
    const buildings = extractExpertTable(ep.items);
    allBuildings.push(...buildings);
  }

  const breakdown = buildExpertBreakdown(allBuildings);
  writeFileSync(cachePath, JSON.stringify(breakdown, null, 2));
  console.log(`    Expert: ${fmt(breakdown.total_enclosed_sqm)} m² enclosed, ${fmt(breakdown.total_terraces_sqm)} m² terraces (${breakdown.buildings.length} building(s))`);
  return breakdown;
}

// ── Stage 2: AI vision extraction ───────────────────────────────────────

async function classifyAndRender(pdfPath, cacheDir, maxImages = 15) {
  const classifyCache = join(cacheDir, 'classification.json');
  const imagesCache = join(cacheDir, 'images.json');

  // Check image cache
  if (existsSync(imagesCache)) {
    const cached = JSON.parse(readFileSync(imagesCache, 'utf-8'));
    // Verify all image files still exist
    const allExist = cached.every(img => existsSync(img.png));
    if (allExist) {
      console.log(`    ↩ Using ${cached.length} cached plan images`);
      return cached;
    }
  }

  console.log('    Classifying pages...');
  const { pages } = await classifyPages(pdfPath);
  writeFileSync(classifyCache, JSON.stringify(pages, null, 2));

  const planPages = pages.filter(p => p.type === 'floor_plan');
  console.log(`    ${planPages.length} floor plan page(s) of ${pages.length} total`);

  if (planPages.length === 0) {
    console.log('    ⚠ No floor plan pages detected');
    return [];
  }

  // Deduplicate pages with same text signature
  const seen = new Set();
  const uniquePlans = [];
  for (const p of planPages) {
    const sig = `${p.width}-${p.height}-${p.textLength}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      uniquePlans.push(p);
    } else {
      console.log(`    ⊘ Skipping duplicate page ${p.pageNum}`);
    }
  }

  // Estimate image count: landscape pages with multiPlan produce ~2 images each
  const estimatedImages = uniquePlans.reduce((sum, p) => sum + (p.isLandscape && p.multiPlan ? 2 : 1), 0);
  if (estimatedImages > maxImages) {
    uniquePlans.sort((a, b) => b.confidence - a.confidence || b.textLength - a.textLength);
    while (uniquePlans.reduce((s, p) => s + (p.isLandscape && p.multiPlan ? 2 : 1), 0) > maxImages) {
      uniquePlans.pop();
    }
    uniquePlans.sort((a, b) => a.pageNum - b.pageNum);
    const newEst = uniquePlans.reduce((s, p) => s + (p.isLandscape && p.multiPlan ? 2 : 1), 0);
    console.log(`    ⚠ Capped to ${uniquePlans.length} pages (~${newEst} images, limit ${maxImages})`);
  }

  console.log(`    Rendering ${uniquePlans.length} unique plan page(s)...`);
  mkdirSync(join(cacheDir, 'pages'), { recursive: true });

  let images = await renderPlanImages(pdfPath, uniquePlans, { maxWidth: 5000, dpi: 300 });

  if (images.length > maxImages) {
    console.log(`    ⚠ Hard cap: ${images.length} → ${maxImages} images`);
    images = images.slice(0, maxImages);
  }

  // Write images to disk and update paths
  for (const img of images) {
    const imgPath = join(cacheDir, 'pages', `${img.name}.png`);
    writeFileSync(imgPath, img.png);
    img.png = imgPath; // replace Buffer with path for caching
  }

  // Cache the image manifest (paths only)
  const manifest = images.map(img => ({
    name: img.name,
    pageNum: img.pageNum,
    png: join(cacheDir, 'pages', `${img.name}.png`),
    width: img.width,
    height: img.height,
    label: img.label,
    floorLabels: img.floorLabels
  }));
  writeFileSync(imagesCache, JSON.stringify(manifest, null, 2));

  console.log(`    Rendered ${images.length} image(s)`);
  return manifest;
}

async function runVisionExtraction(images, modelName, cacheDir, opts = {}) {
  const modelId = resolveModel(modelName);
  const resultDir = join(cacheDir, modelName);
  mkdirSync(resultDir, { recursive: true });

  const cachePath = join(resultDir, 'result.json');
  if (existsSync(cachePath) && !opts.force) {
    console.log(`    ↩ Using cached ${modelName} extraction`);
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  if (opts.dryRun) {
    console.log(`    ⏭ Dry run — skipping ${modelName} API call`);
    return null;
  }

  console.log(`    Sending ${images.length} images to ${modelName} (${modelId})...`);

  const context = images
    .filter(img => img.floorLabels?.length > 0)
    .map(img => `Image "${img.name}": ${img.floorLabels.join(', ')}`)
    .join('\n');

  const result = await extractSqm(images, modelId, { apiKey: opts.apiKey, context: context || undefined });

  // Save raw response and extraction
  writeFileSync(join(resultDir, 'raw-response.txt'), result.rawText);
  if (result.extraction) {
    writeFileSync(join(resultDir, 'extraction.json'), JSON.stringify(result.extraction, null, 2));
  }
  writeFileSync(cachePath, JSON.stringify(result, null, 2));

  console.log(`    ${modelName}: ${fmtTime(result.processingTimeMs)} | ${result.inputTokens}/${result.outputTokens} tokens | ${fmtCost(result.costUsd)}`);
  return result;
}

// ── Stage 3: Compare ────────────────────────────────────────────────────

function runComparison(extraction, expertBreakdown) {
  if (!extraction || !expertBreakdown) return null;
  return compareExtraction(extraction, expertBreakdown);
}

// ── Summary table ───────────────────────────────────────────────────────

function printSummary(allResults) {
  console.log('\n\n' + '═'.repeat(100));
  console.log('  BENCHMARK SUMMARY');
  console.log('═'.repeat(100));

  // Header row
  const modelCols = [...new Set(allResults.map(r => r.model))];
  const colW = 22;
  let header = pad('Dossier', 16) + ' │ ' + pad('Expert m²', 10);
  for (const m of modelCols) {
    header += ' │ ' + pad(m, colW);
  }
  console.log(header);
  console.log('─'.repeat(16) + '─┼─' + '─'.repeat(10) + modelCols.map(() => '─┼─' + '─'.repeat(colW)).join(''));

  // Group by dossier
  const byDossier = new Map();
  for (const r of allResults) {
    if (!byDossier.has(r.dossierLabel)) byDossier.set(r.dossierLabel, []);
    byDossier.get(r.dossierLabel).push(r);
  }

  const aggregates = {};
  for (const m of modelCols) {
    aggregates[m] = { totalDev: 0, count: 0, totalCost: 0, totalTime: 0 };
  }

  for (const [label, results] of byDossier) {
    const expertSqm = results[0]?.expertSqm ?? results[0]?.comparison?.expertTotalSqm ?? '-';
    let row = pad(label, 16) + ' │ ' + pad(fmt(expertSqm), 10);

    for (const m of modelCols) {
      const r = results.find(x => x.model === m);
      if (!r || !r.comparison) {
        row += ' │ ' + pad(r?.error || 'n/a', colW);
      } else {
        const dev = r.comparison.deviationPct;
        const icon = Math.abs(dev) < 5 ? '✓' : Math.abs(dev) < 15 ? '≈' : '✗';
        const cell = `${icon} ${fmt(r.comparison.extractedTotalSqm)}m² ${fmtPct(dev)}`;
        row += ' │ ' + pad(cell, colW);
        aggregates[m].totalDev += Math.abs(dev);
        aggregates[m].count++;
        aggregates[m].totalCost += r.costUsd || 0;
        aggregates[m].totalTime += r.processingTimeMs || 0;
      }
    }
    console.log(row);
  }

  // Aggregates
  console.log('─'.repeat(16) + '─┼─' + '─'.repeat(10) + modelCols.map(() => '─┼─' + '─'.repeat(colW)).join(''));

  let maeRow = pad('MAE', 16) + ' │ ' + pad('', 10);
  let costRow = pad('Total Cost', 16) + ' │ ' + pad('', 10);
  let timeRow = pad('Total Time', 16) + ' │ ' + pad('', 10);

  for (const m of modelCols) {
    const a = aggregates[m];
    const mae = a.count > 0 ? (a.totalDev / a.count).toFixed(1) + '%' : '-';
    maeRow += ' │ ' + pad(mae, colW);
    costRow += ' │ ' + pad(fmtCost(a.totalCost), colW);
    timeRow += ' │ ' + pad(fmtTime(a.totalTime), colW);
  }
  console.log(maeRow);
  console.log(costRow);
  console.log(timeRow);
  console.log('═'.repeat(100));
}

// ── Main pipeline ───────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log('━━━ BuildCost Benchmark Pipeline ━━━\n');

  // Load env
  const envPath = loadEnv();
  if (envPath) console.log(`Loaded env from: ${envPath}`);

  const apiKey = process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !args.dryRun) {
    console.error('✗ No API key found. Set BUILDCOST_ANTHROPIC_KEY in .env.local');
    process.exit(1);
  }

  // Select dossiers
  const dossiers = args.dossierIndices
    ? args.dossierIndices.map(i => DOSSIERS[i]).filter(Boolean)
    : DOSSIERS;

  console.log(`Dossiers: ${dossiers.map(d => d.label).join(', ')}`);
  console.log(`Models:   ${args.models.join(', ')}`);
  console.log(`Output:   ${args.outputDir}`);
  if (args.dryRun) console.log('Mode:     DRY RUN (no API calls)');
  console.log('');

  mkdirSync(args.outputDir, { recursive: true });

  const allResults = [];
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  for (let di = 0; di < dossiers.length; di++) {
    const dossier = dossiers[di];
    const pdfPath = join(DOSSIER_DIR, dossier.file);

    console.log(`\n${'━'.repeat(70)}`);
    console.log(`  [${di + 1}/${dossiers.length}] ${dossier.label}`);
    console.log(`  ${dossier.file}`);
    console.log('━'.repeat(70));

    if (!existsSync(pdfPath)) {
      console.log(`  ✗ File not found: ${pdfPath}`);
      for (const modelName of args.models) {
        allResults.push({ dossierLabel: dossier.label, model: modelName, error: 'file not found' });
      }
      continue;
    }

    const dossierDir = join(args.outputDir, dossier.label.toLowerCase().replace(/[^a-z0-9]/g, '-'));
    mkdirSync(dossierDir, { recursive: true });

    // Stage 1: Expert extraction
    console.log('\n  ── Stage 1: Expert Ground Truth ──');
    let expertBreakdown = null;
    try {
      expertBreakdown = await extractExpert(pdfPath, dossierDir);
    } catch (e) {
      console.log(`    ✗ Expert extraction failed: ${e.message}`);
    }
    const expertSqm = expertBreakdown?.total_enclosed_sqm;

    // Stage 2: Classify + render (shared across models)
    console.log('\n  ── Stage 2: Classify & Render ──');
    let images = [];
    try {
      images = await classifyAndRender(pdfPath, dossierDir, args.maxImages);
    } catch (e) {
      console.log(`    ✗ Classification/rendering failed: ${e.message}`);
      for (const modelName of args.models) {
        allResults.push({ dossierLabel: dossier.label, model: modelName, expertSqm, error: 'render failed' });
      }
      continue;
    }

    if (images.length === 0) {
      for (const modelName of args.models) {
        allResults.push({ dossierLabel: dossier.label, model: modelName, expertSqm, error: 'no plan pages' });
      }
      continue;
    }

    // Stage 2b + 3: Run each model
    for (const modelName of args.models) {
      console.log(`\n  ── Model: ${modelName} ──`);

      let result = null;
      try {
        result = await runVisionExtraction(images, modelName, dossierDir, {
          apiKey,
          dryRun: args.dryRun
        });
      } catch (e) {
        console.log(`    ✗ ${modelName} extraction failed: ${e.message}`);
        allResults.push({ dossierLabel: dossier.label, model: modelName, expertSqm, error: e.message.slice(0, 80) });
        continue;
      }

      if (!result) {
        allResults.push({ dossierLabel: dossier.label, model: modelName, expertSqm, error: 'no result' });
        continue;
      }

      // Stage 3: Compare
      const comparison = runComparison(result.extraction, expertBreakdown);
      if (comparison) {
        console.log(`    ${formatComparison(comparison).split('\n')[0]}`);

        const compDir = join(dossierDir, modelName);
        writeFileSync(join(compDir, 'comparison.json'), JSON.stringify(comparison, null, 2));
      }

      allResults.push({
        dossierLabel: dossier.label,
        dossierFile: dossier.file,
        model: modelName,
        modelId: resolveModel(modelName),
        expertSqm,
        extractedSqm: comparison?.extractedTotalSqm,
        comparison,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        processingTimeMs: result.processingTimeMs,
        costUsd: result.costUsd,
        imageSizeMb: result.imageSizeMb,
        imageCount: result.imageCount
      });
    }
  }

  // Save full results
  const resultsPath = join(args.outputDir, `run-${runTimestamp}.json`);
  writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));
  console.log(`\nFull results saved to: ${resultsPath}`);

  // Summary table
  printSummary(allResults);
}

main().catch(e => {
  console.error(`\n✗ Pipeline failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
