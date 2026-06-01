/**
 * run-trainset.mjs — enqueue the training dossiers through the pipeline.
 * Creates an estimation per dossier + a processing_queue job (benchmark).
 * The local worker drains them, producing extracted_qqps in estimations.
 * Writes scripts/trainset-runmap.csv (ref,dossier_id,estimation_id,expert_f).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const TENANT = "00000000-0000-0000-0000-000000000001";

const rows = readFileSync("scripts/trainset-clean.csv", "utf8").split("\n").slice(1).filter(Boolean)
  .map((r) => { const [ref, id, path, f] = r.split(","); return { ref, id, path, f }; });

const runmap = ["ref,dossier_id,estimation_id,expert_f"];
let ok = 0;
for (const r of rows) {
  // 1. create estimation
  const estRes = await fetch(`${URL}/rest/v1/estimations`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ tenant_id: TENANT, plan_storage_path: r.path, plan_file_name: `${r.ref}_Plannen.pdf`, status: "uploading" }),
  });
  const est = (await estRes.json())[0];
  if (!est?.id) { console.log(`  ! estimation insert faalde voor ${r.ref}: ${JSON.stringify(est).slice(0,120)}`); continue; }
  // 2. enqueue benchmark job (reduced render settings)
  const qRes = await fetch(`${URL}/rest/v1/processing_queue`, {
    method: "POST", headers: H,
    body: JSON.stringify({ estimation_id: est.id, job_type: "benchmark", priority: 5, payload: { maxWidth: 2500, dpi: 150, maxPages: 12 } }),
  });
  if (!qRes.ok) { console.log(`  ! queue insert faalde voor ${r.ref}`); continue; }
  runmap.push(`${r.ref},${r.id},${est.id},${r.f}`);
  ok++;
  console.log(`  + ${r.ref} -> est ${est.id.slice(0,8)} (F-target ${r.f})`);
}
writeFileSync("scripts/trainset-runmap.csv", runmap.join("\n"));
console.log(`\nEnqueued ${ok}/${rows.length} jobs. Worker verwerkt ze nu. Runmap: scripts/trainset-runmap.csv`);
