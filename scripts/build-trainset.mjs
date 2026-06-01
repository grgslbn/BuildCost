/**
 * build-trainset.mjs — clean the trainset and resolve dossier_id + storage path.
 * Filters to dossiers with meaningful CAT1 (>=80 m²) and an uploaded plan.
 * Output: scripts/trainset-clean.csv (ref,dossier_id,plan_storage_path,expert_f,cat1,cat2,cat3)
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
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const rows = readFileSync("scripts/trainset.csv", "utf8").split("\n").slice(1).filter(Boolean)
  .map((r) => { const [ref, f, c1, c2, c3] = r.split(","); return { ref, f: +f, cat1: +c1, cat2: +c2, cat3: +c3 }; })
  .filter((x) => x.cat1 >= 80);  // meaningful CAT1

console.log(`Trainset na cat1>=80 filter: ${rows.length}`);

// resolve dossier_id + plan_storage_path
const names = rows.map((r) => `"${r.ref}_Plannen.pdf"`).join(",");
const res = await fetch(`${URL}/rest/v1/reference_dossiers?select=id,plan_file_name,plan_storage_path&plan_file_name=in.(${encodeURIComponent(names)})`, { headers: H });
const dossiers = await res.json();
const byName = {};
for (const d of dossiers) byName[d.plan_file_name] = d;

const out = [];
for (const r of rows) {
  const d = byName[`${r.ref}_Plannen.pdf`];
  if (!d?.plan_storage_path) { console.log(`  ! geen plan in storage: ${r.ref}`); continue; }
  out.push({ ...r, id: d.id, path: d.plan_storage_path });
}

const csv = ["ref,dossier_id,plan_storage_path,expert_f,cat1,cat2,cat3"];
for (const o of out) csv.push(`${o.ref},${o.id},${o.path},${o.f.toFixed(3)},${o.cat1},${o.cat2},${o.cat3}`);
writeFileSync("scripts/trainset-clean.csv", csv.join("\n"));
console.log(`Bruikbaar (plan in storage): ${out.length} -> scripts/trainset-clean.csv`);
console.log("F-spreiding:", out.map((o) => o.f.toFixed(2)).sort().join(" "));
