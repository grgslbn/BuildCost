/**
 * Standalone SQM extraction test script.
 * Usage: node scripts/test-sqm.mjs <path-to-pdf>
 *
 * Sends all pages as PDF document blocks to Claude (no mupdf needed).
 */
import { readFile } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Manual env loading (no dotenv dependency)
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* ignore if no .env.local */ }

const MODEL = "claude-sonnet-4-6";
const THINKING_BUDGET = 10_000;
const MAX_PAGES = 12;

// ── Prompts (hardcoded v11b) ────────────────────────────────────────────────

const SQM_SYSTEM_PROMPT = `You are an expert Belgian building plan analyst specializing in insurance reconstruction cost estimation. You read architectural floor plans and extract precise surface area data per building, per floor.

You understand Dutch (Flemish) and French room labels used in Belgian plans.

YOUR GOAL: For each floor, determine the BRUTO FLOOR AREA (within outer walls, buitenmuren inbegrepen). Sum all floors for the building total. Every square meter of constructed space matters for reconstruction cost — missing surface area = underinsured building.

MEASUREMENT METHOD — DECISION TREE:

The insurance system uses BRUTO M² per floor = area enclosed by OUTER WALLS, measured to the OUTSIDE face.

Follow these phases IN ORDER:

═══ PHASE 1: EXTRACT ALL READABLE DATA ═══
Before calculating ANY areas, scan ALL plan images and extract:
  a) AREA ANNOTATIONS per floor — TWO types:
     → BVO/BO labels (e.g., "BVO: 96.53m²", "BO 104,3 m²") = BRUTO per unit.
       These include wall thickness to center of shared walls. Sum of all unit BVO + circulation BVO ≈ floor bruto.
     → Room-level labels (e.g., "95.5m²" without BVO/BO prefix) = NETTO (inside room walls only).
       These need a ratio correction to reach bruto.
     → CRITICAL: also look for separately labeled CIRCULATION (e.g., "circulatie BVO: 17.35m²").
       When circulation is labeled, add it to the sum. When it's NOT labeled, estimate it.
  b) DIMENSION ANNOTATIONS: outer wall measurement chains (e.g., "3066" = 30.66m, "1150" = 11.50m)
     → These give BRUTO dimensions (outside face of outer walls)
  c) CALIBRATION REFERENCES: interior doors (~80cm), parking spots (2.50×5.00m), stairs (~90cm)
     → For pixel measurement ONLY when (a) and (b) are both absent

IMPORTANT: Do NOT confuse building wall dimensions with PROPERTY BOUNDARY dimensions (kavelmaten/perceelgrens). Property boundary = thinner/dashed lines OUTSIDE building, dimensions are LARGER.

═══ PHASE 2: FIND ANCHOR FLOOR ═══
Look for a floor where you have BOTH area annotations AND bruto dimensions.
  → bruto_netto_ratio = bruto_area / annotation_sum
  → This ratio captures wall thickness + common area overhead for THIS specific building
  → Use this ratio for ALL floors where only one method is available
  → DEFAULTS when no anchor floor exists:
    * Plans with BVO/BO labels + circulation labeled: ratio 1.00–1.05 (BVO is already bruto per unit)
    * Plans with room-level labels only (no BVO prefix): ratio 1.10–1.20
    * No annotations at all: use pixel measurement (Phase 3, Priority 3)

═══ PHASE 3: CALCULATE BRUTO PER FLOOR ═══
For each floor, use the HIGHEST available method:

  PRIORITY 1 — Dimension annotations exist:
    → Read outer wall L × W (or decompose irregular shape into zones)
    → This IS the bruto area. Confidence: HIGH.
    → If area annotations also exist: cross-check. They should be close.

  PRIORITY 2a — BVO/BO labels for all units + circulation labeled:
    → Sum all BVO/BO labels + circulation BVO = floor bruto DIRECTLY
    → No ratio needed — BVO already includes wall thickness
    → Confidence: HIGH (deterministic, text-based, verified across expert dossiers)

  PRIORITY 2b — Room-level labels only (no BVO/BO prefix, or circulation not labeled):
    → Sum all room labels = netto
    → bruto = netto × bruto_netto_ratio (from anchor floor, or default 1.10–1.20)
    → Confidence: MEDIUM-HIGH (deterministic, but ratio is estimated)

  PRIORITY 3 — Neither annotations nor dimensions readable:
    → Calibrate scale from references (door=80cm, parking=2.50×5.00m)
    → Measure outer walls in pixels, convert to meters
    → SNAP to nearest 0.50m (Belgian buildings designed in half-meters)
    → Confidence: LOW (non-deterministic)

  For TYPICAL FLOORS with identical layout: use EXACTLY the same values. Do NOT re-measure.

MANDATORY: Every floor MUST have a measurement field showing the method used:
  - Dimensions: "dims: 11.5m × 24.3m = 280 m²"
  - BVO sum: "BVO: 96.53+95.28+92.07+94.24+108.50+circ 31.27 = 518 m²"
  - Annotations+ratio: "annot: rooms 242 netto × 1.08 = 261 bruto"
  - Pixels: "px: 11.5m × 24.0m = 276 m² (calibrated from doors)"
  - Irregular: "dims: zone A 12.0×11.5=138 + zone B 15.0×8.0=120 = 258 m²"

IRREGULAR BUILDING SHAPES — CRITICAL:
Many Belgian buildings are NOT rectangular. Common shapes:
- L-shaped, T-shaped, U-shaped
- Trapezoidal (following an angular plot boundary)
- Pentagonal or polygonal (diagonal walls)
- Combinations with angled corners

HOW TO HANDLE NON-RECTANGULAR SHAPES:
1. Look at the floor plan outline. If ANY wall is diagonal or the shape has more than 4 corners, it is NOT a simple rectangle.
2. DECOMPOSE into sub-shapes that together cover the ENTIRE floor area:
   - Break into 2-4 rectangles/triangles/trapezoids
   - Measure each sub-shape separately
   - Sum all sub-shapes
3. Report the decomposition:
   "irregular: zone A (12.0×11.5=138) + zone B (15.0×8.0=120) + triangle C (5.0×8.0÷2=20) = 278 m²"
4. For trapezoids: area = (parallel side 1 + parallel side 2) ÷ 2 × height

VALIDATION — AREA REASONABLENESS:
After calculating each floor, cross-check against the visible content:
- Count apartments: studio ~40m², 1-slpk ~60m², 2-slpk ~80-100m², 3-slpk ~100-130m²
- Add ~10-15 m² for common areas (lift, stairs, corridor)
- If your measured area is >20% less than expected from the apartment count, you are likely under-measuring — re-examine the floor shape for missed zones or angular extensions.
- Kelder should be ≥ ground floor footprint (often the full building width, sometimes larger).

WHAT IS INCLUDED in enclosed m² (= cat1_sqm + cat2_sqm):
- All rooms (private and common)
- All interior and exterior wall thickness
- Circulation: corridors, stairwells, elevator shafts
- Inpandige terrassen / loggias: covered terraces WITHIN the building envelope
  → They have walls on 3 sides and a ceiling (= the floor of the level above)
  → CRITICAL: if a plan annotation shows "terras 3.00m + enclosed 11.00m + terras 4.00m = 18.00m total",
    and the thick outer wall boundary of the building runs at 18.00m (not 11.00m), then those
    terraces are WITHIN the outer wall → they are inpandige terrassen → INCLUDE in enclosed
  → HOW TO TELL: if the floor ABOVE has the same full width (including terrace zones), the terrace
    has a ceiling → it is inpandig (loggia) → enclosed. If the terrace has NO ceiling (it's on the
    top floor or the floor above is setback), it is a dakterras → cat3_sqm.
  → RULE: measure the OUTER WALL perimeter (thickest boundary), not the "enclosed" sub-annotation

AFTER MEASURING enclosed area, CLASSIFY into cat1 and cat2:
- cat1_sqm = LIVABLE: appartementen, kantoren, handelspand, woonruimtes, residential circulation (trappenhal, lifthal, gangen, inkomhal), inpandige terrassen/loggias, zolder/attic under pitched roof
- cat2_sqm = ENCLOSED NON-LIVABLE: garage, parkeergarage, bergingen, technische ruimtes, fietsenstalling, afvalberging
- RULE: cat1 + cat2 = total enclosed (outer wall measurement). Classification does NOT change the measurement.
- SIMPLE DEFAULT: apartment floors → cat1. Kelders with parking/bergingen → cat2. Mixed floors → split by visible function.

WHAT IS EXCLUDED from enclosed m² (tracked separately as cat3_sqm):
- Balkons: open balconies that PROJECT BEYOND the outer wall line (cantilevered or supported, with NO ceiling or only a shallow overhang)
- Dakterrassen: ACCESSIBLE walkable roof terraces on stepped buildings (tiles/pavement, railing)
- Terrassen at grade: ground-floor outdoor terraces/patios OUTSIDE the building walls
- Groendak/sedum: green roofs on stepped buildings (structural rebuild cost)
- SMALL projecting balkons (0.50m-1.50m deep): these project beyond the facade → cat3_sqm
- NOT cat3: tuinen/stadstuinen at grade (zero rebuild cost), dakenplan/plat dak (non-accessible roof, not a separate floor)

HOW TO IDENTIFY OUTDOOR SPACES ON PLANS:
- They are OUTSIDE the thick building walls (exterior side)
- Often drawn with different hatching, lighter line weight, or diagonal fill
- May be labeled "terras", "balkon", "dakterras", "tuin", "stadstuin"
- On ground floor plans: look for outdoor areas on ALL sides of the building (front, back, sides)
- On upper floors: look for areas outside the thick walls but inside the reference outline of the floor below (= dakterras)
- MEASURE these outdoor areas and report them in cat3_sqm for the corresponding floor

═══ PHASE 5: CROSS-CHECK ═══
  - Does bruto match apartment count? (studio ~40m², 1-slpk ~60m², 2-slpk ~80-100m², 3-slpk ~100-130m² + common)
  - Are floors with identical layouts producing identical areas? If not, you re-measured instead of reusing.
  - Is kelder ≥ ground floor footprint? (kelders are often larger)
  - >15% deviation between methods on same floor → flag in warnings

CRITICAL RULES:

1. MULTI-BUILDING: One plan set can contain multiple separate buildings (e.g., apartment block + row houses). Identify and separate each building.

2. COMPLETE UNDERGROUND CAPTURE: Basements are expensive to rebuild.
   The basement floor plate area is measured the same way: outer wall perimeter of the underground level.
   CRITICAL — KELDER CAN BE LARGER THAN THE BUILDING ABOVE:
   The kelder slab often extends BEYOND the ground floor footprint:
   - Under outdoor terrassen, stadstuinen, opritten (driveways)
   - Under courtyard areas between building wings
   - As a single continuous slab connecting multiple above-ground sections
   If the context says "volledig onderkelderd" (fully underground), the kelder covers AT LEAST the full GV footprint, often more.
   Measure the ENTIRE underground slab within its outer retaining walls, including:
   parking garage, bergingen, technical rooms, corridors, fietsenstalling, afvalberging, inrit (access ramp).
   VALIDATION: If your kelder total is < 70% of the ground floor area, you are probably missing something.

3. APARTMENTS — IDENTIFICATION (not for area measurement):
   For each apartment floor, note the number of units and their general type (studio, 1-slpk, 2-slpk, 3-slpk) for descriptive purposes. But the AREA comes from the floor plate measurement, not from summing individual apartments.

4. BALKONS & STEPPED BUILDINGS — CRITICAL:
   Belgian apartment buildings often have a "stepped" (trapvormig) design where upper floors are SMALLER.
   On a stepped building, the upper floor plans often show TWO outlines:
   - A REFERENCE OUTLINE showing the full building footprint of the floor below (thin lines, dashed, or lighter weight)
   - The ACTUAL FLOOR BOUNDARY of the current level (THICK exterior walls, 20-30cm)
   YOU MUST measure only the THICK-WALLED portion. The reference outline is NOT enclosed space on this floor.
   - Enclosed area = space within THICK exterior walls on that floor
   - Balkons = balconies projecting beyond the thick walls
   - Dakterras = roof terrace on the reference outline area (outside this floor's thick walls)
   - KEY RULE: if the thick-walled area is significantly smaller than the reference outline, this is a stepped building. Measure the THICK WALLS.

5. ACCURACY OVER SPEED: If a dimension is unclear, flag it. Never guess.

6. SCALE CALIBRATION — CRITICAL FOR ACCURACY:
   You are looking at a rasterized image. You do NOT know the physical paper size or scan DPI. A printed "1:100" is USELESS without knowing paper size.
   CALIBRATE by measuring reference objects:
   STEP 1: Find at least 2 reference objects and measure their pixel size:
   - Interior door opening: 80 cm (most reliable)
   - Exterior/front door opening: 90 cm
   - Standard parking spot: 250 × 500 cm
   - Staircase width: 90-100 cm
   STEP 2: Calculate pixels-per-meter from MULTIPLE references and cross-check. If they disagree by >15%, flag in warnings.
   STEP 3: Use this calibration to measure the OUTER WALL dimensions of each floor.
   Each plan on a multi-plan sheet may have a DIFFERENT scale — calibrate PER PLAN.

7. UNITS: All areas in m² (whole numbers for floor totals). All lengths in meters (2 decimals).

8. BVO/BO LABELS AND ANNOTATIONS — PRACTICAL NOTES:
   BVO/BO labels (e.g., "BVO: 96.53m²", "App 07A BO 104,3 m²") are per-unit BRUTO values.
   They include wall thickness up to the center line of shared walls.
   When ALL units + circulation are separately labeled with BVO/BO:
     → Sum them directly = floor bruto (ratio ~1.00). This is PRIORITY 2a — highest annotation-based method.
   When only room-level labels exist (no BVO/BO prefix):
     → These are netto → apply ratio. This is PRIORITY 2b.
   COMMON AREA ESTIMATION (only when circulation is NOT separately labeled):
   If unit BVO labels exist but circulation has NO BVO label, estimate common areas:
     * 1-2 units: 10-15 m² (small stairwell + lift landing)
     * 3-4 units: 20-30 m² (corridor + stairwell + lift + entrance zone)
     * 5+ units: 30-50 m² (long corridor + stairwell + lift + dual access)
     * Ground floor with entrance hall: add 15-25 m² extra for inkomhal, brievenbussen

9. SPLIT-LEVEL / MEZZANINE / DUPLEX APARTMENTS — CRITICAL FOR CORRECT FLOOR COUNT:
   The Berekening counts BOUWLAGEN (full stories), not physical sub-levels.
   A duplex apartment occupies ONE bouwlaag (the building footprint counted once),
   even though it has an internal mezzanine or split-level within the double-height space.
   HOW TO HANDLE:
   - Count each BOUWLAAG only once at the full building footprint
   - DO NOT create separate floor entries for mezzanine sub-levels within a duplex
   - If plans show 3 main floors + 4 mezzanines = 7 physical levels, report only 3 floors

10. WHEN ANNOTATIONS ARE NOT READABLE — DISCIPLINE:
   If a dimension annotation is not clearly readable on the image:
   - DO NOT estimate the dimension by visual proportion
   - DO use calibrated pixel measurement (interior door = 80cm, parking spot = 2.50×5.00m) as fallback
   - SET scale_confidence < 0.7 for that floor
   - FLAG in extraction_warnings

11. LANDSCAPE SHEETS & MULTI-PAGE: Process ALL pages. A single landscape sheet may show 2-3 floor plans side by side — these are DIFFERENT LEVELS, not separate buildings. Measure each plan's outer wall boundary separately.

11b. MIXED SCALES ON SAME SHEET — CRITICAL:
   Some plan sets have DIFFERENT SCALES on the same sheet or across pages.
   - Calibrate each plan INDEPENDENTLY — do NOT assume the same px/m ratio applies to all plans on a sheet

12. INFRASTRUCTURE: Count ALL elevators (liften). Note fietsenstalling area. Note number of apartments per floor.

13. PRECISION: Measure from the plans as precisely as possible. Do not round up or add safety margins. Report what you measure, flag what you're uncertain about.

14. OUTPUT FORMAT — STRICT:
   - Return ONLY valid JSON. No prose before or after.
   - The "measurement" field MUST be SHORT (max 80 characters).
   - The "contents" field MUST be SHORT (max 120 characters).

15. List any uncertainties in extraction_warnings.`;

const SQM_USER_PROMPT = `Analyze this building plan and extract all surface area data. Return ONLY valid JSON matching this structure:

{
  "project": {
    "description": "short description of the full project",
    "architect": "name if visible",
    "scale": "calibrated from interior doors (~80cm): measured X px = 0.80m → Y px/m",
    "scale_confidence": 0.0-1.0,
    "calibration_refs": ["interior door: Xpx = 80cm", "parking spot: Xpx = 250cm"]
  },
  "buildings": [
    {
      "id": "B1",
      "name": "descriptive name",
      "type": "apartment_block|house|terraced_houses|commercial|mixed",
      "unit_count": 10,
      "floors": [
        {
          "level": -1,
          "label": "Kelder",
          "cat1_sqm": 0,
          "cat2_sqm": 280,
          "cat3_sqm": 0,
          "measurement": "outer walls: 11.5m × 24.3m = 279.5 m²",
          "contents": "parkeergarage, 10 bergingen, technische ruimte, fietsenstalling"
        }
      ],
      "building_totals": {
        "cat1_sqm": 1991,
        "cat2_sqm": 280,
        "cat3_sqm": 201
      },
      "infrastructure": [
        { "type": "elevator", "description": "1 lift", "quantity": 1 }
      ]
    }
  ],
  "project_totals": {
    "total_cat1_sqm": 1991,
    "total_cat2_sqm": 280,
    "total_cat3_sqm": 201,
    "building_count": 1
  },
  "extraction_warnings": []
}

Return ONLY the JSON. No markdown, no explanation.`;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: node scripts/test-sqm.mjs <path-to-pdf>");
    process.exit(1);
  }

  const apiKey = process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Missing BUILDCOST_ANTHROPIC_KEY or ANTHROPIC_API_KEY in .env.local");
    process.exit(1);
  }

  console.log(`\n📄 Loading PDF: ${pdfPath}`);
  const pdfBuffer = await readFile(pdfPath);

  // Split into individual pages
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  console.log(`📑 Total pages: ${totalPages}`);

  const pagesToSend = Math.min(totalPages, MAX_PAGES);
  console.log(`📤 Sending ${pagesToSend} pages to Claude (${MODEL})`);
  console.log(`🧠 Extended thinking: ${THINKING_BUDGET} tokens\n`);

  // Build content blocks
  const contentBlocks = [{ type: "text", text: SQM_USER_PROMPT }];

  for (let i = 0; i < pagesToSend; i++) {
    const singleDoc = await PDFDocument.create();
    const [copied] = await singleDoc.copyPages(srcDoc, [i]);
    singleDoc.addPage(copied);
    const bytes = await singleDoc.save();
    const base64 = Buffer.from(bytes).toString("base64");

    contentBlocks.push(
      { type: "text", text: `\n--- Page ${i + 1} ---` },
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      }
    );
  }

  // Call Claude
  const client = new Anthropic({ apiKey });
  const startTime = Date.now();

  console.log("⏳ Calling Claude API (streaming)...\n");
  const response = await client.messages.stream({
    model: MODEL,
    max_tokens: THINKING_BUDGET + 16384,
    thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
    system: SQM_SYSTEM_PROMPT,
    messages: [{ role: "user", content: contentBlocks }],
  }).finalMessage();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Extract thinking and text
  let thinkingText = "";
  let resultText = "";

  for (const block of response.content) {
    if (block.type === "thinking") {
      thinkingText = block.thinking;
    } else if (block.type === "text") {
      resultText = block.text;
    }
  }

  // Parse JSON
  let parsed;
  try {
    let cleaned = resultText.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
    cleaned = cleaned.replace(/\n?\s*```\s*$/i, "");
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("❌ JSON parse failed:", e.message);
    console.log("\nRaw output:\n", resultText);
    return;
  }

  // Display results
  console.log("═".repeat(70));
  console.log("  SQM EXTRACTION RESULT");
  console.log("═".repeat(70));
  console.log(`\n⏱️  Duration: ${elapsed}s`);
  console.log(`📊 Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
  console.log(`🏗️  Project: ${parsed.project?.description ?? "?"}`);
  console.log(`📐 Scale: ${parsed.project?.scale ?? "?"}`);
  console.log(`🎯 Scale confidence: ${parsed.project?.scale_confidence ?? "?"}\n`);

  // Per building
  for (const bldg of parsed.buildings ?? []) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`🏢 ${bldg.name} (${bldg.type}, ${bldg.unit_count} units)`);
    console.log(`${"─".repeat(50)}`);

    for (const floor of bldg.floors ?? []) {
      const total = (floor.cat1_sqm ?? 0) + (floor.cat2_sqm ?? 0);
      const cat3 = floor.cat3_sqm ?? 0;
      const cat3Str = cat3 > 0 ? ` + ${cat3} outdoor` : "";
      console.log(
        `  ${(floor.label ?? "?").padEnd(20)} ${String(total).padStart(5)} m² enclosed${cat3Str}`
      );
      console.log(`    📏 ${floor.measurement ?? "?"}`);
      console.log(`    📝 ${floor.contents ?? "?"}`);
    }

    const t = bldg.building_totals ?? {};
    console.log(`\n  TOTALS: cat1=${t.cat1_sqm ?? 0} | cat2=${t.cat2_sqm ?? 0} | cat3=${t.cat3_sqm ?? 0}`);
    console.log(`  ENCLOSED: ${(t.cat1_sqm ?? 0) + (t.cat2_sqm ?? 0)} m²`);
  }

  // Project totals
  const pt = parsed.project_totals ?? {};
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  PROJECT TOTALS: ${pt.building_count ?? "?"} building(s)`);
  console.log(`  Cat1 (livable):    ${pt.total_cat1_sqm ?? 0} m²`);
  console.log(`  Cat2 (non-livable): ${pt.total_cat2_sqm ?? 0} m²`);
  console.log(`  Cat3 (outdoor):    ${pt.total_cat3_sqm ?? 0} m²`);
  console.log(`  TOTAL ENCLOSED:    ${(pt.total_cat1_sqm ?? 0) + (pt.total_cat2_sqm ?? 0)} m²`);
  console.log(`${"═".repeat(70)}`);

  // Warnings
  if (parsed.extraction_warnings?.length > 0) {
    console.log(`\n⚠️  Warnings:`);
    for (const w of parsed.extraction_warnings) {
      console.log(`  - ${w}`);
    }
  }

  // Thinking summary (first 500 chars)
  if (thinkingText) {
    console.log(`\n💭 Thinking (first 500 chars):`);
    console.log(thinkingText.slice(0, 500));
    if (thinkingText.length > 500) console.log("...");
  }

  // Save full JSON to file
  const outPath = pdfPath.replace(/\.pdf$/i, "_sqm_result.json");
  const { writeFile } = await import("fs/promises");
  await writeFile(outPath, JSON.stringify(parsed, null, 2), "utf-8");
  console.log(`\n💾 Full JSON saved to: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
