// scripts/benchmark-compare.mjs
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local (same pattern) ─────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = await readFile(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local */ }

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { values: args } = parseArgs({
  options: {
    run1: { type: "string" },
    run2: { type: "string" },
  },
});

async function resolveRunId(label) {
  if (!label || label === "latest") {
    const { data } = await admin.from("evaluation_runs").select("id").eq("status", "complete").order("completed_at", { ascending: false }).limit(1).single();
    return data?.id;
  }
  if (label === "previous") {
    const { data } = await admin.from("evaluation_runs").select("id").eq("status", "complete").order("completed_at", { ascending: false }).limit(2);
    return data?.[1]?.id;
  }
  return label; // UUID
}

async function main() {
  const runId1 = await resolveRunId(args.run1 || "previous");
  const runId2 = await resolveRunId(args.run2 || "latest");

  if (!runId1 || !runId2) {
    console.error("Need at least 2 complete runs. Use --run1=<id> --run2=<id>");
    process.exit(1);
  }

  const [{ data: run1 }, { data: run2 }] = await Promise.all([
    admin.from("evaluation_runs").select("*").eq("id", runId1).single(),
    admin.from("evaluation_runs").select("*").eq("id", runId2).single(),
  ]);

  const [{ data: results1 }, { data: results2 }] = await Promise.all([
    admin.from("evaluation_results").select("dossier_id, cost_error_pct, cat1_error_pct, f_error, error_message").eq("run_id", runId1),
    admin.from("evaluation_results").select("dossier_id, cost_error_pct, cat1_error_pct, f_error, error_message").eq("run_id", runId2),
  ]);

  const m1 = run1.metrics || {};
  const m2 = run2.metrics || {};

  console.log(`\n── Comparing Runs ───────────────────────`);
  console.log(`Run 1: "${run1.name}" (${run1.dossier_count} dossiers)`);
  console.log(`Run 2: "${run2.name}" (${run2.dossier_count} dossiers)\n`);

  const metrics = [
    ["Cost MAE",      m1.cost_mae_pct,      m2.cost_mae_pct],
    ["Cost Median",   m1.cost_median_pct,    m2.cost_median_pct],
    ["Cost Worst",    m1.cost_worst_pct,     m2.cost_worst_pct],
    ["% within 10%",  m1.cost_within_10_pct, m2.cost_within_10_pct],
    ["% within 15%",  m1.cost_within_15_pct, m2.cost_within_15_pct],
    ["Cat1 MAE",      m1.cat1_mae_pct,       m2.cat1_mae_pct],
    ["F MAE",         m1.f_mae,              m2.f_mae],
  ];

  console.log("Metric".padEnd(16) + "Run 1".padStart(10) + "Run 2".padStart(10) + "Delta".padStart(10) + "  ");
  console.log("─".repeat(52));
  for (const [label, v1, v2] of metrics) {
    const s1 = v1 != null ? v1.toFixed(1) : "N/A";
    const s2 = v2 != null ? v2.toFixed(1) : "N/A";
    const delta = v1 != null && v2 != null ? v2 - v1 : null;
    const dStr = delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : "";
    // For error metrics: lower is better. For "within" metrics: higher is better.
    const isWithin = label.startsWith("%");
    const improved = delta != null && (isWithin ? delta > 0 : delta < 0);
    const icon = delta == null ? "" : improved ? "✅" : delta === 0 ? "➖" : "⚠️";
    console.log(`${label.padEnd(16)}${s1.padStart(10)}${s2.padStart(10)}${dStr.padStart(10)}  ${icon}`);
  }

  // Per-dossier comparison
  const map1 = new Map((results1 ?? []).map((r) => [r.dossier_id, r]));
  const map2 = new Map((results2 ?? []).map((r) => [r.dossier_id, r]));
  const allIds = new Set([...map1.keys(), ...map2.keys()]);

  let improved = 0, worsened = 0, unchanged = 0;
  for (const id of allIds) {
    const r1 = map1.get(id);
    const r2 = map2.get(id);
    if (!r1 || !r2 || r1.cost_error_pct == null || r2.cost_error_pct == null) continue;
    const diff = Math.abs(r2.cost_error_pct) - Math.abs(r1.cost_error_pct);
    if (diff < -2) improved++;
    else if (diff > 2) worsened++;
    else unchanged++;
  }

  console.log(`\n── Per-Dossier ──────────────────────────`);
  console.log(`Improved (>2%): ${improved}  Worsened (>2%): ${worsened}  Unchanged: ${unchanged}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
