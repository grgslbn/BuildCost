/**
 * aggregate-chain.mjs — aggregaat v2 van chain-reader resultaten.
 * Metrics per dossier:
 *  - Δcat1 (m²)
 *  - Δcost: kostengewogen m²-subtotaal (cat1×2040 + cat2×1200 + cat3×700) — dit is het
 *    eerlijke ±10%-criterium: conventieverschillen (inpandige terrassen cat1 vs cat3)
 *    vallen er grotendeels uit en de weging volgt de werkelijke kostenimpact.
 * Gate v2: AUTO = verifier-pass (hermeting ≤8% en geen allocatie/missing issues).
 *          Zonder verify-file: GATED (conservatief).
 * Usage: node scripts/aggregate-chain.mjs [--model=claude-opus-5]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = (process.argv.find((a) => a.startsWith("--model=")) || "").slice(8) || "claude-opus-5";
const slug = MODEL.replace(/[^a-z0-9]/gi, "");
const P = { cat1: 2040, cat2: 1200, cat3: 700 };
const gtAuto = existsSync(join(ROOT, "scripts", "gt-auto.json")) ? JSON.parse(readFileSync(join(ROOT, "scripts", "gt-auto.json"), "utf8")) : {};

const rows = [];
for (const f of readdirSync(join(ROOT, "scripts")).filter((f) => f.startsWith("chain-") && f.endsWith(`-${slug}.json`))) {
  try {
    const r = JSON.parse(readFileSync(join(ROOT, "scripts", f), "utf8"));
    if (!r.report || !r.gt) continue;
    const g = { cat1: r.gt.strict_cat1 || r.gt.heated_m2 || 0, cat2: r.gt.cat2_m2 || 0, cat3: r.gt.cat3_m2 || 0 };
    // manual GT mist vaak cat2/cat3 — vul aan uit gt-auto (tabel-gelezen), anders is de kostenmetric scheef
    if ((!g.cat2 || !g.cat3) && gtAuto[r.ref]) {
      if (!g.cat2) g.cat2 = gtAuto[r.ref].cat2_m2 || 0;
      if (!g.cat3) g.cat3 = gtAuto[r.ref].cat3_m2 || 0;
    }
    if (!g.cat1) continue;
    const m = { cat1: r.report.cat1_m2 || 0, cat2: r.report.cat2_m2 || 0, cat3: r.report.cat3_m2 || 0 };
    const costM = m.cat1 * P.cat1 + m.cat2 * P.cat2 + m.cat3 * P.cat3;
    const costG = g.cat1 * P.cat1 + g.cat2 * P.cat2 + g.cat3 * P.cat3;
    const vf = join(ROOT, "scripts", `verify-${r.ref}-${slug}.json`);
    let verify = null;
    if (existsSync(vf)) verify = JSON.parse(readFileSync(vf, "utf8"));
    rows.push({
      ref: r.ref,
      d1: +(((m.cat1 - g.cat1) / g.cat1) * 100).toFixed(1),
      dCost: +(((costM - costG) / costG) * 100).toFixed(1),
      verify: verify ? (verify.pass ? "PASS" : "FAIL") : "—",
      vDev: verify ? verify.deviation_pct : null,
      vIssues: verify ? verify.allocation_issues.length + verify.missing_parts.length : null,
      auto: !!verify?.pass,
    });
  } catch { /* skip */ }
}
rows.sort((a, b) => Math.abs(a.dCost) - Math.abs(b.dCost));
console.log("ref          Δcat1    Δcost   verifier(dev,issues)  gate");
for (const r of rows) console.log(`${r.ref}  ${String(r.d1).padStart(6)}%  ${String(r.dCost).padStart(6)}%  ${r.verify}${r.vDev !== null ? `(${r.vDev}%,${r.vIssues})` : ""}  ${r.auto ? "AUTO" : "GATED"}`);
const abs = (a, k) => a.map((r) => Math.abs(r[k])).sort((x, y) => x - y);
const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : NaN);
const auto = rows.filter((r) => r.auto);
console.log(`\nTOTAAL n=${rows.length} | mediaan |Δcost| ${med(abs(rows, "dCost"))}% | Δcost binnen 10%: ${rows.filter((r) => Math.abs(r.dCost) <= 10).length}/${rows.length}`);
console.log(`AUTO   n=${auto.length} | Δcost binnen 10%: ${auto.filter((r) => Math.abs(r.dCost) <= 10).length}/${auto.length} ← doel: alle AUTO binnen 10%`);
console.log(`GATED  n=${rows.length - auto.length}`);
