import { execSync } from 'child_process';

const TESTS = [
  { script: 'test-54024.mjs', label: 'VICTORINE' },
  { script: 'test-54207.mjs', label: 'DIE PRINCE' },
  { script: 'test-54222.mjs', label: 'LA TACHE' },
  { script: 'test-54628.mjs', label: 'BARON DE L' },
  { script: 'test-54679-33.mjs', label: 'DORENBOSBEEK' },
  { script: 'test-54679-31.mjs', label: 'SANGLIER' },
  { script: 'test-54683.mjs', label: 'Rusthuis Stockel' },
  { script: 'test-54756-061.mjs', label: 'HOOST' },
  { script: 'test-54756-037.mjs', label: 'Knokke duplex' },
  { script: 'test-55271.mjs', label: 'HAPPY TIMES' },
  { script: 'test-54723.mjs', label: 'Maurice' },
  { script: 'test-55302-020.mjs', label: 'OCMW Lint' },
  { script: 'test-55308.mjs', label: 'Dorp 59' },
  { script: 'test-54204.mjs', label: 'VICTOR VICTORIA' },
  { script: 'test-55192.mjs', label: 'VIERHOEKHOEVE' },
  { script: 'test-51660.mjs', label: 'NOLA' },
  { script: 'test-53709.mjs', label: 'FRASCATI' },
  { script: 'test-dossier4.mjs', label: 'Anna Monica' },
  { script: 'test-54728.mjs', label: 'Aalter' },
  { script: 'test-54756-022.mjs', label: 'MURANO' },
  { script: 'test-dossier3.mjs', label: 'Prestige I' },
  { script: 'test-54011.mjs', label: 'DOBBELSTEEN' },
  { script: 'test-54018.mjs', label: 'Wiekevorst' },
  { script: 'test-55355.mjs', label: 'LUKOR' },
];

const startFrom = parseInt(process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '0');
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];

const results = [];
const testsToRun = only
  ? TESTS.filter(t => t.label.toLowerCase().includes(only.toLowerCase()))
  : TESTS.slice(startFrom);

console.log(`\n${'='.repeat(70)}`);
console.log(`V9 FULL BENCHMARK — ${testsToRun.length} dossiers`);
console.log(`${'='.repeat(70)}\n`);

for (let i = 0; i < testsToRun.length; i++) {
  const t = testsToRun[i];
  const num = startFrom + i + 1;
  console.log(`\n[${num}/${TESTS.length}] ${t.label} (${t.script})`);
  console.log('─'.repeat(50));

  try {
    const output = execSync(`node scripts/${t.script}`, {
      timeout: 400_000,
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    const totalMatch = output.match(/Total: (\d+(?:\.\d+)?) m² vs expert (\d+(?:\.\d+)?) m² \(([+-]?\d+(?:\.\d+)?)%\)/);
    const costMatch = output.match(/Cost: \$(\d+\.\d+)/);
    const timeMatch = output.match(/Done in (\d+\.\d+)s/);

    if (totalMatch) {
      const [, aiTotal, expertTotal, devPct] = totalMatch;
      results.push({
        label: t.label,
        aiTotal: parseFloat(aiTotal),
        expertTotal: parseFloat(expertTotal),
        devPct: parseFloat(devPct),
        cost: parseFloat(costMatch?.[1] || '0'),
        time: parseFloat(timeMatch?.[1] || '0'),
        status: 'OK',
      });
      const icon = Math.abs(parseFloat(devPct)) < 1 ? '✓' : Math.abs(parseFloat(devPct)) < 5 ? '≈' : '✗';
      console.log(`  ${icon} ${devPct}% (${aiTotal} vs ${expertTotal} m²) — ${timeMatch?.[1] || '?'}s, $${costMatch?.[1] || '?'}`);
    } else if (output.includes('no expert') || output.includes('NO expert') || !output.includes('vs expert')) {
      results.push({ label: t.label, status: 'NO_EXPERT' });
      console.log(`  — No expert comparison data`);
    } else {
      results.push({ label: t.label, status: 'PARSE_ISSUE', output: output.slice(-200) });
      console.log(`  ⚠ Could not parse results`);
    }
  } catch (err) {
    const timedOut = err.message?.includes('ETIMEDOUT') || err.status === null;
    results.push({
      label: t.label,
      status: timedOut ? 'TIMEOUT' : 'ERROR',
      error: err.message?.slice(0, 100)
    });
    console.log(`  ✗ ${timedOut ? 'TIMEOUT' : 'ERROR'}: ${err.message?.slice(0, 100)}`);
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log(`V9 BENCHMARK SUMMARY`);
console.log(`${'='.repeat(70)}\n`);

const okResults = results.filter(r => r.status === 'OK');
const perfect = okResults.filter(r => Math.abs(r.devPct) < 1);
const good = okResults.filter(r => Math.abs(r.devPct) >= 1 && Math.abs(r.devPct) < 5);
const bad = okResults.filter(r => Math.abs(r.devPct) >= 5);
const failed = results.filter(r => r.status === 'ERROR' || r.status === 'TIMEOUT');

console.log(`  Perfect (< 1%): ${perfect.length}`);
console.log(`  Good (1-5%):    ${good.length}`);
console.log(`  Off (> 5%):     ${bad.length}`);
console.log(`  Failed:         ${failed.length}`);
console.log(`  No expert:      ${results.filter(r => r.status === 'NO_EXPERT').length}`);
console.log('');

console.log(`  ${'Dossier'.padEnd(22)} ${'Dev%'.padStart(8)} ${'AI'.padStart(7)} ${'Expert'.padStart(7)} ${'Time'.padStart(6)} ${'Cost'.padStart(7)}`);
console.log(`  ${'─'.repeat(57)}`);

for (const r of results) {
  if (r.status === 'OK') {
    const icon = Math.abs(r.devPct) < 1 ? '✓' : Math.abs(r.devPct) < 5 ? '≈' : '✗';
    const dev = (r.devPct > 0 ? '+' : '') + r.devPct + '%';
    console.log(`  ${icon} ${r.label.padEnd(20)} ${dev.padStart(8)} ${String(r.aiTotal).padStart(7)} ${String(r.expertTotal).padStart(7)} ${(r.time.toFixed(0) + 's').padStart(6)} $${r.cost.toFixed(4)}`);
  } else if (r.status === 'NO_EXPERT') {
    console.log(`  — ${r.label.padEnd(20)} (no expert data)`);
  } else {
    console.log(`  ✗ ${r.label.padEnd(20)} ${r.status}`);
  }
}

const totalCost = okResults.reduce((s, r) => s + r.cost, 0);
const totalTime = okResults.reduce((s, r) => s + r.time, 0);
console.log(`\n  Total: $${totalCost.toFixed(4)} / ${(totalTime / 60).toFixed(1)} min`);
