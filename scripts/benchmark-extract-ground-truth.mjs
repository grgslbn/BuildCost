// scripts/benchmark-extract-ground-truth.mjs
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

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
const anthropicKey = process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUILDCOST_ANTHROPIC_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anthropic = new Anthropic({ apiKey: anthropicKey });

// ── Load ground truth prompt ────────────────────────────────────────
const SYSTEM_PROMPT = `You are extracting ground truth data from a Belgian building insurance expert's valuation report.

The expert report contains a reconstruction cost calculation. You must extract:
1. The total reconstruction cost (herbouwwaarde / valeur de reconstruction)
2. The area breakdown by category

Area categories:
- CAT1 (bewoonbaar/habitable): living rooms, bedrooms, kitchen, bathrooms, office, hallway, stairs, dressing — all enclosed livable space
- CAT2 (bijgebouw/annexe): garage, storage (berging), utility room (technische ruimte) — enclosed but not livable
- CAT3 (buitenruimte/extérieur): terrace (terras), balcony (balkon) — outdoor built areas
- EXCLUDED: garden (tuin/jardin), parking spaces, driveways

Look for:
- A summary table with total price (often labeled "totaal herbouwwaarde", "total valeur de reconstruction", "totale reconstructiewaarde")
- Area measurements per room or per category (often in m²)
- The expert may use NL (Dutch) or FR (French) terminology

Important:
- Extract the FINAL total price, not intermediate subtotals
- If the expert provides m² per individual room, sum them into the three categories
- If the expert only provides a total m², put it all in cat1 and set cat2/cat3 to 0
- Prices should be in EUR without VAT adjustments
- If you cannot find a value, set it to null`;

const USER_PROMPT = `Extract the ground truth values from this expert valuation report.

Return ONLY valid JSON (no markdown, no explanation):

{
  "expert_total_price": <number or null>,
  "expert_cat1_sqm": <number or null>,
  "expert_cat2_sqm": <number or null>,
  "expert_cat3_sqm": <number or null>,
  "expert_finishing_level": <string or null>,
  "confidence": <number 0.0-1.0>
}`;

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  // Find dossiers without ground truth
  const { data: dossiers, error: dErr } = await admin
    .from("reference_dossiers")
    .select("id, plan_storage_path, plan_file_name, page_classifications")
    .not("plan_storage_path", "is", null);

  if (dErr || !dossiers) {
    console.error("Failed to fetch dossiers:", dErr?.message);
    process.exit(1);
  }

  // Get existing ground truth dossier IDs
  const { data: existing } = await admin
    .from("benchmark_ground_truth")
    .select("dossier_id");
  const existingIds = new Set((existing ?? []).map((r) => r.dossier_id));

  const toProcess = dossiers.filter((d) => !existingIds.has(d.id));
  console.log(`Found ${dossiers.length} dossiers, ${toProcess.length} need ground truth extraction.\n`);

  if (toProcess.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const dossier = toProcess[i];
    const label = dossier.plan_file_name || dossier.id.slice(0, 8);
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${label}  `);

    try {
      // Download PDF
      const { data: fileBlob, error: dlErr } = await admin.storage
        .from("plans")
        .download(dossier.plan_storage_path);
      if (dlErr || !fileBlob) throw new Error(`Download failed: ${dlErr?.message}`);

      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      const base64 = buffer.toString("base64");

      // Determine which pages to send (expert_report + pricing_table)
      const classifications = dossier.page_classifications;
      let pageNote = "";
      if (Array.isArray(classifications)) {
        const expertPages = classifications
          .filter((c) => c.type === "expert_report" || c.type === "pricing_table")
          .map((c) => c.pageNumber);
        if (expertPages.length > 0) {
          pageNote = ` (expert pages: ${expertPages.join(", ")})`;
        }
      }

      // Send entire PDF to Claude — it can read all pages
      const content = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        },
        {
          type: "text",
          text: USER_PROMPT + (pageNote ? `\n\nNote: pages likely containing expert data: ${pageNote}` : ""),
        },
      ];

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      });

      const text = response.content.find((b) => b.type === "text")?.text ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      const parsed = JSON.parse(jsonMatch[0]);

      // Insert ground truth
      const { error: insertErr } = await admin
        .from("benchmark_ground_truth")
        .insert({
          dossier_id: dossier.id,
          expert_total_price: parsed.expert_total_price,
          expert_cat1_sqm: parsed.expert_cat1_sqm,
          expert_cat2_sqm: parsed.expert_cat2_sqm,
          expert_cat3_sqm: parsed.expert_cat3_sqm,
          expert_finishing_level: parsed.expert_finishing_level,
          extraction_confidence: parsed.confidence,
        });

      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

      const price = parsed.expert_total_price ? `€${parsed.expert_total_price.toLocaleString()}` : "?";
      const sqm = parsed.expert_cat1_sqm ? `${parsed.expert_cat1_sqm}m²` : "?";
      console.log(`✓  ${price}  ${sqm}  conf=${parsed.confidence}`);
      succeeded++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n── Done ──────────────────────────────`);
  console.log(`Extracted: ${succeeded}  Failed: ${failed}  Total: ${toProcess.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
