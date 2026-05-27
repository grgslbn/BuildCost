/**
 * Bulk upload split dossiers (plan + berekening) to Supabase.
 *
 * Reads SPLIT_V2 folder with files like:
 *   23-483997_Plannen.pdf
 *   23-483997_Berekening.pdf
 *
 * For each unique dossier number:
 *   1. Creates a reference_dossiers row
 *   2. Uploads plan PDF to Supabase Storage
 *   3. Uploads calculation PDF to Supabase Storage
 *   4. Updates storage paths in DB
 *
 * Usage:
 *   node scripts/bulk-upload-split-dossiers.mjs --source "C:\path\to\SPLIT_V2"
 *   node scripts/bulk-upload-split-dossiers.mjs --source "..." --clean   # delete old dossiers first
 *   node scripts/bulk-upload-split-dossiers.mjs --source "..." --dry-run # preview only
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// ── Load .env.local ─────────────────────────────────────────────────
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── CLI args ────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    source:   { type: "string" },
    clean:    { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    tenant:   { type: "string" },
    batch:    { type: "string", default: "5" },
  },
});

const sourceDir = args.source;
const dryRun = args["dry-run"];
const cleanFirst = args.clean;
const batchSize = parseInt(args.batch) || 5;

if (!sourceDir) {
  console.error('Usage: node scripts/bulk-upload-split-dossiers.mjs --source "C:\\path\\to\\SPLIT_V2"');
  process.exit(1);
}

// ── Resolve tenant ──────────────────────────────────────────────────
let tenantId = args.tenant;
if (!tenantId) {
  const { data: tenants } = await admin.from("tenants").select("id, name").limit(1);
  if (!tenants?.length) {
    console.error("No tenants found. Create one first or pass --tenant <uuid>");
    process.exit(1);
  }
  tenantId = tenants[0].id;
  console.log(`Using tenant: ${tenants[0].name} (${tenantId})`);
}

// ── Scan source directory ───────────────────────────────────────────
console.log(`\nScanning: ${sourceDir}`);
const allFiles = await readdir(sourceDir);
const pdfFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".pdf"));

// Group by dossier number
const dossierMap = new Map(); // dossierNr -> { plan?: filename, calculation?: filename }

for (const file of pdfFiles) {
  let nr, type;
  if (file.endsWith("_Plannen.pdf")) {
    nr = file.replace("_Plannen.pdf", "");
    type = "plan";
  } else if (file.endsWith("_Berekening.pdf")) {
    nr = file.replace("_Berekening.pdf", "");
    type = "calculation";
  } else {
    console.warn(`  Skipping unknown pattern: ${file}`);
    continue;
  }

  if (!dossierMap.has(nr)) dossierMap.set(nr, {});
  dossierMap.get(nr)[type] = file;
}

const total = dossierMap.size;
const withBoth = [...dossierMap.values()].filter((d) => d.plan && d.calculation).length;
const planOnly = [...dossierMap.values()].filter((d) => d.plan && !d.calculation).length;
const calcOnly = [...dossierMap.values()].filter((d) => !d.plan && d.calculation).length;

console.log(`\nFound ${total} dossiers:`);
console.log(`  ${withBoth} complete (plan + berekening)`);
console.log(`  ${planOnly} plan only`);
console.log(`  ${calcOnly} berekening only`);

if (dryRun) {
  console.log("\n[DRY RUN] Would upload the above. Re-run without --dry-run to execute.");
  process.exit(0);
}

// ── Clean old dossiers if requested ─────────────────────────────────
if (cleanFirst) {
  console.log("\nCleaning old reference_dossiers...");

  // Delete evaluation data first (cascade should handle it, but be explicit)
  const { data: oldDossiers } = await admin
    .from("reference_dossiers")
    .select("id, plan_storage_path, calculation_storage_path");

  if (oldDossiers?.length) {
    // Delete storage files
    const storagePaths = oldDossiers
      .flatMap((d) => [d.plan_storage_path, d.calculation_storage_path])
      .filter(Boolean);

    if (storagePaths.length > 0) {
      console.log(`  Removing ${storagePaths.length} files from storage...`);
      // Supabase storage remove accepts arrays of up to 100 paths
      for (let i = 0; i < storagePaths.length; i += 100) {
        const batch = storagePaths.slice(i, i + 100);
        await admin.storage.from("plans").remove(batch);
      }
    }

    // Delete dependent tables that reference dossiers (FK constraints)
    console.log("  Cleaning dependent tables...");
    await admin.from("qqp_discovery_log").delete().not("id", "is", null);
    await admin.from("benchmark_annotations").delete().not("id", "is", null);
    await admin.from("evaluation_results").delete().not("id", "is", null);
    await admin.from("benchmark_ground_truth").delete().not("id", "is", null);
    await admin.from("evaluation_runs").delete().not("id", "is", null);

    // Now delete dossiers
    console.log(`  Deleting ${oldDossiers.length} old dossiers...`);
    const { error: delErr } = await admin
      .from("reference_dossiers")
      .delete()
      .not("id", "is", null); // delete all

    if (delErr) {
      console.error("  Failed to delete:", delErr.message);
      process.exit(1);
    }

    console.log("  Done.");
  } else {
    console.log("  No old dossiers found.");
  }
}

// ── Upload dossiers ─────────────────────────────────────────────────
console.log(`\nUploading ${total} dossiers in batches of ${batchSize}...`);

const dossierEntries = [...dossierMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
let uploaded = 0;
let failed = 0;

async function uploadDossier(nr, files) {
  const dossierId = randomUUID();

  try {
    // 1. Create DB row
    const insertData = {
      id: dossierId,
      tenant_id: tenantId,
      plan_file_name: files.plan || null,
      calculation_file_name: files.calculation || null,
      status: "pending",
    };

    const { error: dbErr } = await admin.from("reference_dossiers").insert(insertData);
    if (dbErr) throw new Error(`DB insert: ${dbErr.message}`);

    // 2. Upload plan
    if (files.plan) {
      const filePath = join(sourceDir, files.plan);
      const fileBuffer = await readFile(filePath);
      const storagePath = `${tenantId}/${dossierId}/plan-${files.plan}`;

      const { error: upErr } = await admin.storage
        .from("plans")
        .upload(storagePath, fileBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new Error(`Plan upload: ${upErr.message}`);

      await admin
        .from("reference_dossiers")
        .update({ plan_storage_path: storagePath })
        .eq("id", dossierId);
    }

    // 3. Upload calculation
    if (files.calculation) {
      const filePath = join(sourceDir, files.calculation);
      const fileBuffer = await readFile(filePath);
      const storagePath = `${tenantId}/${dossierId}/calculation-${files.calculation}`;

      const { error: upErr } = await admin.storage
        .from("plans")
        .upload(storagePath, fileBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new Error(`Calculation upload: ${upErr.message}`);

      await admin
        .from("reference_dossiers")
        .update({ calculation_storage_path: storagePath })
        .eq("id", dossierId);
    }

    uploaded++;
    const planMB = files.plan ? ((await stat(join(sourceDir, files.plan))).size / 1024 / 1024).toFixed(1) : "—";
    const calcMB = files.calculation ? ((await stat(join(sourceDir, files.calculation))).size / 1024 / 1024).toFixed(1) : "—";
    console.log(`  [${uploaded + failed}/${total}] ✓ ${nr} (plan: ${planMB}MB, calc: ${calcMB}MB)`);
  } catch (err) {
    failed++;
    console.error(`  [${uploaded + failed}/${total}] ✗ ${nr}: ${err.message}`);
    // Clean up partial row
    await admin.from("reference_dossiers").delete().eq("id", dossierId);
  }
}

// Process in batches for concurrency control
for (let i = 0; i < dossierEntries.length; i += batchSize) {
  const batch = dossierEntries.slice(i, i + batchSize);
  await Promise.all(batch.map(([nr, files]) => uploadDossier(nr, files)));
}

console.log(`\n${"=".repeat(50)}`);
console.log(`Done: ${uploaded} uploaded, ${failed} failed, ${total} total`);
console.log(`Dossiers in DB: run 'SELECT count(*) FROM reference_dossiers' to verify`);
