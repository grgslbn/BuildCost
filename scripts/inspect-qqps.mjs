/**
 * inspect-qqps.mjs — diagnose the stored QQP scores across the 15 GT dossiers.
 * Why does the model saturate at the F=0.70 floor?
 *
 * Reports:
 *  1. Per-QQP coverage (how often present/non-zero) + mean/min/max score
 *  2. Per-dossier F decomposition (intercept + Σ contributions, top pullers)
 *  3. Whether equipment QQPs (the luxe drivers) are even being extracted
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=intercept,weights`, { headers: H })).json())[0];
const W = model.weights, intercept = model.intercept;

const results = await (await fetch(`${U}/rest/v1/evaluation_results?select=dossier_id,extracted_qqps,predicted_f,created_at&order=created_at.desc`, { headers: H })).json();
const latest = {};
for (const r of results) {
  if (!r.extracted_qqps || !Object.keys(r.extracted_qqps).length) continue;
  if (!latest[r.dossier_id]) latest[r.dossier_id] = r;
}
const dossiers = Object.values(latest);
console.log(`Dossiers met QQP-data: ${dossiers.length}\n`);

// QQP groups (from reference-ranges.ts)
const EQUIPMENT = ["kitchen_appliance_count","has_kitchen_island","bathroom_luxury_score","has_fireplace","has_open_kitchen","built_in_storage_count"];
const LUXE_DRIVERS = [...EQUIPMENT, "has_dressing","has_wellness","bathroom_per_bedroom_ratio","bathroom_count","toilet_count"];

// ── 1. Per-QQP coverage ──────────────────────────────────────────────────────
const allQqps = new Set();
for (const d of dossiers) for (const k of Object.keys(d.extracted_qqps)) allQqps.add(k);

const stats = {};
for (const q of allQqps) {
  const vals = [];
  for (const d of dossiers) {
    const v = d.extracted_qqps[q];
    if (v && typeof v.score === "number") vals.push(v.score);
  }
  const present = vals.length;
  const nonzero = vals.filter((s) => s !== 0).length;
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  stats[q] = { present, nonzero, mean, min: Math.min(...vals), max: Math.max(...vals), vals };
}

console.log("═".repeat(92));
console.log("QQP".padEnd(30) + "weight  aanwezig  ≠0    gem score   min/max     → bijdrage aan F (w×gem)");
console.log("═".repeat(92));
const sorted = [...allQqps].sort((a, b) => (W[b] ?? 0) - (W[a] ?? 0));
for (const q of sorted) {
  const s = stats[q];
  const w = W[q] ?? 0;
  const contrib = s.mean != null ? w * s.mean : 0;
  const tag = LUXE_DRIVERS.includes(q) ? " ★luxe" : "";
  console.log(
    q.padEnd(30) +
    w.toFixed(3).padStart(6) + "  " +
    `${s.present}/${dossiers.length}`.padStart(7) + "  " +
    `${s.nonzero}`.padStart(3) + "   " +
    (s.mean != null ? s.mean.toFixed(2) : "—").padStart(7) + "   " +
    `${s.min.toFixed(1)}/${s.max.toFixed(1)}`.padStart(10) + "   " +
    (contrib >= 0 ? "+" : "") + contrib.toFixed(3).padStart(6) + tag
  );
}

// ── 2. Per-dossier F decomposition ───────────────────────────────────────────
console.log("\n" + "═".repeat(92));
console.log("F-DECOMPOSITIE per dossier (intercept 0.913 + Σ bijdragen)");
console.log("═".repeat(92));
const clamp = (f) => Math.max(0.70, Math.min(1.50, f));
for (const d of dossiers) {
  const contribs = [];
  let sum = intercept;
  for (const [q, v] of Object.entries(d.extracted_qqps)) {
    if (v && typeof v.score === "number") {
      const c = (W[q] ?? 0) * v.score;
      sum += c;
      if (Math.abs(c) > 0.001) contribs.push([q, c, v.score]);
    }
  }
  contribs.sort((a, b) => a[1] - b[1]); // most negative first
  const fRaw = sum, fClamped = clamp(sum);
  const floored = fRaw < 0.70 ? " ⚠VLOER" : "";
  const pos = contribs.filter((c) => c[1] > 0).reduce((s, c) => s + c[1], 0);
  const neg = contribs.filter((c) => c[1] < 0).reduce((s, c) => s + c[1], 0);
  console.log(`\n${d.dossier_id.slice(0, 8)}  F_raw=${fRaw.toFixed(3)} → ${fClamped.toFixed(2)}${floored}   (Σ+ ${pos.toFixed(2)}, Σ− ${neg.toFixed(2)})`);
  const top = contribs.slice(0, 3).concat(contribs.slice(-2)).filter((v, i, a) => a.indexOf(v) === i);
  console.log("   grootste duwers: " + contribs.slice(0, 3).map(([q, c, s]) => `${q}(s=${s.toFixed(1)},${c >= 0 ? "+" : ""}${c.toFixed(2)})`).join("  "));
}

// ── 3. Equipment coverage summary ────────────────────────────────────────────
console.log("\n" + "═".repeat(92));
console.log("LUXE-DRIVERS dekking (deze QQPs onderscheiden goedkoop vs duur):");
for (const q of LUXE_DRIVERS) {
  const s = stats[q];
  if (!s) { console.log(`  ${q.padEnd(30)} NIET aanwezig in data`); continue; }
  console.log(`  ${q.padEnd(30)} aanwezig ${s.present}/${dossiers.length}, ≠0: ${s.nonzero}, gem ${s.mean != null ? s.mean.toFixed(2) : "—"}`);
}
