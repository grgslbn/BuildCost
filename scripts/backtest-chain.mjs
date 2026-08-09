/**
 * backtest-chain.mjs — Fase 3: draait de chain-reader over een set refs (met GT in
 * gt-auto.json of sqm-groundtruth.json) en aggregeert de afwijkingen.
 *
 * Gating-regel (Fase 2): een run telt als AUTO wanneer confidence >= 0.6 EN de
 * deterministische verificatie geen problemen vond EN er geen ondergrens-flag is;
 * anders GATED (→ handmatig paneel). Doel: alle AUTO-runs binnen ±10%.
 *
 * Usage: node scripts/backtest-chain.mjs <ref1,ref2,...|--auto[=N]> [--conc=2] [--model=claude-opus-5]
 *   --auto: alle refs uit gt-auto.json die nog geen chain-result hebben (max N)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = (process.argv.find((a) => a.startsWith("--model=")) || "").slice(8) || "claude-opus-5";
const CONC = parseInt((process.argv.find((a) => a.startsWith("--conc=")) || "").slice(7) || "2", 10);
const modelSlug = MODEL.replace(/[^a-z0-9]/gi, "");

const gtAuto = existsSync(join(ROOT, "scripts", "gt-auto.json")) ? JSON.parse(readFileSync(join(ROOT, "scripts", "gt-auto.json"), "utf8")) : {};
const autoArg = process.argv.find((a) => a.startsWith("--auto"));
let refs;
if (autoArg) {
  const maxN = parseInt(autoArg.split("=")[1] || "999", 10);
  refs = Object.keys(gtAuto).filter((r) => !existsSync(join(ROOT, "scripts", `chain-${r}-${modelSlug}.json`))).slice(0, maxN);
} else {
  refs = (process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
}
console.log(`backtest: ${refs.length} refs, model ${MODEL}, conc ${CONC}`);

function runOne(ref) {
  return new Promise((res) => {
    const p = spawn("node", [join(ROOT, "scripts", "chain-reader.mjs"), ref, `--model=${MODEL}`, "--max-turns=60"], { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    p.stdout.on("data", (d) => { tail = (tail + d).slice(-400); });
    p.stderr.on("data", () => { /* ignore */ });
    const kill = setTimeout(() => { p.kill(); }, 40 * 60 * 1000);
    p.on("close", (code) => { clearTimeout(kill); console.log(`[${ref}] exit ${code}: ...${tail.split("\n").filter(Boolean).slice(-3).join(" | ")}`); res(code); });
  });
}

// simple concurrency pool
const queue = [...refs];
await Promise.all([...Array(Math.min(CONC, queue.length))].map(async () => {
  while (queue.length) { const r = queue.shift(); await runOne(r); }
}));

// ---------- aggregate everything present ----------
const rows = [];
for (const f of readdirSync(join(ROOT, "scripts")).filter((f) => f.startsWith("chain-") && f.endsWith(`-${modelSlug}.json`))) {
  try {
    const r = JSON.parse(readFileSync(join(ROOT, "scripts", f), "utf8"));
    if (!r.report || !r.gt) continue;
    const gt1 = r.gt.strict_cat1 || r.gt.heated_m2 || 0;
    if (!gt1) continue;
    const d1 = ((r.report.cat1_m2 - gt1) / gt1) * 100;
    const lowerBound = (r.report.flags || []).some((x) => /ondergrens|onzichtbaar/i.test(x));
    const gated = (r.report.confidence || 0) < 0.6 || (r.verification?.problems?.length || 0) > 0 || lowerBound;
    rows.push({ ref: r.ref, d1: +d1.toFixed(1), conf: r.report.confidence, gated, verifProblems: r.verification?.problems?.length || 0, lowerBound, min: r.minutes });
  } catch { /* skip */ }
}
rows.sort((a, b) => Math.abs(a.d1) - Math.abs(b.d1));
console.log("\nref          Δcat1   conf  gated  verif  min");
for (const r of rows) console.log(`${r.ref}  ${String(r.d1).padStart(6)}%  ${r.conf}  ${r.gated ? "GATED" : "AUTO "}  ${r.verifProblems}      ${r.min}`);
const auto = rows.filter((r) => !r.gated), abs = (a) => a.map((r) => Math.abs(r.d1)).sort((x, y) => x - y);
const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : NaN);
console.log(`\nTOTAAL n=${rows.length} | mediaan |Δ| ${med(abs(rows))}% | binnen 10%: ${rows.filter((r) => Math.abs(r.d1) <= 10).length}/${rows.length}`);
console.log(`AUTO   n=${auto.length} | mediaan |Δ| ${med(abs(auto))}% | binnen 10%: ${auto.filter((r) => Math.abs(r.d1) <= 10).length}/${auto.length} ← doelcriterium: 100%`);
console.log(`GATED  n=${rows.length - auto.length} (→ handmatig paneel)`);
