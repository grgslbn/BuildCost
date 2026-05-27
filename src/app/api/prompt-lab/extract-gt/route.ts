// GET: pending dossiers without ground truth
// POST: extract ground truth for one dossier via Claude
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

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

// ── GET: list dossiers that still need ground truth ────────────────
export async function GET() {
  const admin = createSupabaseAdminClient();

  const { data: dossiers } = await admin
    .from("reference_dossiers")
    .select("id, plan_file_name, calculation_file_name, calculation_storage_path")
    .not("plan_storage_path", "is", null);

  const { data: existing } = await admin
    .from("benchmark_ground_truth")
    .select("dossier_id");

  const existingIds = new Set((existing ?? []).map((r) => r.dossier_id));
  const pending = (dossiers ?? []).filter((d) => !existingIds.has(d.id));

  return NextResponse.json({
    pending: pending.map((d) => ({
      id: d.id,
      name: d.plan_file_name ?? d.id.slice(0, 8),
      hasCalculation: !!d.calculation_storage_path,
    })),
    total: dossiers?.length ?? 0,
    alreadyExtracted: existingIds.size,
  });
}

// ── POST: extract ground truth for one dossier ────────────────────
export async function POST(req: NextRequest) {
  try {
    const { dossierId } = (await req.json()) as { dossierId: string };
    if (!dossierId) {
      return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const { data: dossier } = await admin
      .from("reference_dossiers")
      .select("id, plan_storage_path, plan_file_name, calculation_storage_path, calculation_file_name, page_classifications")
      .eq("id", dossierId)
      .single();

    if (!dossier) {
      return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
    }

    // Prefer calculation file for GT extraction; fall back to plan (legacy VerzamelPDF)
    const gtFilePath = dossier.calculation_storage_path ?? dossier.plan_storage_path;
    if (!gtFilePath) {
      return NextResponse.json({ error: "No file available for GT extraction" }, { status: 404 });
    }

    // Download PDF from storage
    const { data: fileBlob, error: dlErr } = await admin.storage
      .from("plans")
      .download(gtFilePath);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: `Download failed: ${dlErr?.message}` }, { status: 500 });
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const base64 = buffer.toString("base64");

    // Note which pages contain expert data
    let pageNote = "";
    if (Array.isArray(dossier.page_classifications)) {
      const expertPages = (dossier.page_classifications as { type: string; pageNumber: number }[])
        .filter((c) => c.type === "expert_report" || c.type === "pricing_table")
        .map((c) => c.pageNumber);
      if (expertPages.length > 0) {
        pageNote = `\n\nNote: pages likely containing expert data: ${expertPages.join(", ")}`;
      }
    }

    // Call Claude
    const anthropic = new Anthropic({
      apiKey: process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: USER_PROMPT + pageNote },
        ],
      }],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "No JSON in Claude response" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Insert ground truth row
    const { error: insertErr } = await admin.from("benchmark_ground_truth").insert({
      dossier_id: dossierId,
      expert_total_price: parsed.expert_total_price,
      expert_cat1_sqm: parsed.expert_cat1_sqm,
      expert_cat2_sqm: parsed.expert_cat2_sqm,
      expert_cat3_sqm: parsed.expert_cat3_sqm,
      expert_finishing_level: parsed.expert_finishing_level,
      extraction_confidence: parsed.confidence,
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      fileName: dossier.plan_file_name,
      result: {
        expert_total_price: parsed.expert_total_price,
        expert_cat1_sqm: parsed.expert_cat1_sqm,
        confidence: parsed.confidence,
      },
    });
  } catch (err) {
    console.error("[benchmark/extract-gt]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
