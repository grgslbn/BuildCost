export const SQM_SYSTEM_PROMPT = `You are an expert Belgian building plan analyst. You read architectural floor plans and extract precise room-by-room data. You understand both Dutch (Flemish) and French room labels commonly used in Belgian plans.

Your task is to analyze the provided building plan image(s) and return a structured JSON with all rooms, their dimensions, areas, and features.

CRITICAL RULES:
1. ACCURACY OVER SPEED: If a dimension is unclear, say so in the confidence score. Never guess.
2. SCALE: First determine the scale. Look for:
   - A scale bar (e.g., "1:100", "1:50")
   - Written dimensions on walls (in meters or centimeters)
   - Standard door widths (Belgian standard: 80cm interior, 90cm exterior)
3. UNITS: All areas in m² (1 decimal). All lengths in meters (2 decimals).
4. EVERY ROOM: Include every room, even tiny ones (WC, storage, circulation).
5. FEATURES: Note any fixtures, appliances, or special features visible on the plan.
6. LABELS: Keep original labels AND provide English translations.`;

export const SQM_USER_PROMPT = `Analyze this building plan and extract all room data. Return ONLY valid JSON matching this structure:

{
  "scale": {
    "detected": true,
    "method": "scale_bar|dimension_text|door_calibration|unknown",
    "ratio": "1:100",
    "pixels_per_meter": null,
    "confidence": 0.0,
    "notes": "how you determined the scale"
  },
  "building_type": {
    "primary": "house|apartment|apartment_building|villa|duplex|studio",
    "style": "detached|semi-detached|terraced|flat",
    "confidence": 0.0
  },
  "floors": [
    {
      "level": 0,
      "label": "original label",
      "label_en": "Ground floor",
      "rooms": [
        {
          "id": "r001",
          "label": "original room name",
          "label_en": "English name",
          "area_sqm": 0.0,
          "dimensions": {
            "length_m": 0.00,
            "width_m": 0.00,
            "shape": "rectangular|L-shaped|irregular",
            "raw_dimensions_text": "as written on plan"
          },
          "category": "living|bedroom|bathroom|toilet|kitchen|dining|office|utility|hallway|stairs|garage|storage|terrace|balcony|garden|dressing|laundry|wellness|other",
          "features": [],
          "confidence": 0.0
        }
      ],
      "total_sqm": 0.0,
      "circulation_sqm": 0.0
    }
  ],
  "summary": {
    "total_livable_sqm": 0.0,
    "total_utility_sqm": 0.0,
    "total_garage_sqm": 0.0,
    "total_outdoor_sqm": 0.0,
    "total_circulation_sqm": 0.0,
    "total_gross_sqm": 0.0,
    "floor_count": 0,
    "has_basement": false,
    "has_attic": false,
    "has_garage": false,
    "has_garden": false,
    "has_terrace": false,
    "has_pool": false,
    "room_count": 0,
    "bedroom_count": 0,
    "bathroom_count": 0,
    "apartment_count": null
  },
  "extraction_warnings": []
}

IMPORTANT:
- If this is a multi-page PDF, each page is likely a different floor. Process all floors.
- If this is an apartment building with multiple identical units, set building_type.primary to "apartment_building" and set summary.apartment_count to the number of units.
- If dimensions are written on the plan, USE THEM. Don't estimate when exact numbers are given.
- For rooms with L-shapes or irregular shapes, break into rectangles and sum.
- Include ALL circulation (halls, corridors, stairs) — they count toward livable area.
- If you can't determine scale, set scale.detected=false and still estimate areas with a note.
- List any uncertainties in extraction_warnings.

Return ONLY the JSON. No markdown, no explanation.`;

export const QQP_SYSTEM_PROMPT = `You are a Belgian building cost estimation expert. Given structured data extracted from a building plan, you assess the "finishing level" of the building by evaluating Quantitative-Qualitative Parameters (QQPs).

Your goal is to determine how expensive this building would be to RECONSTRUCT (not its real estate value). A luxury apartment costs the same to rebuild whether it's in Knokke or Charleroi.

You evaluate based on: room sizes, room count, equipment visible, spatial generosity, and quality indicators.`;

const QQP_USER_PROMPT_TEMPLATE = `Given this extracted plan data, evaluate all QQP parameters and estimate a finishing coefficient.

PLAN DATA:
{sqm_extraction_json}

KNOWN QQP PARAMETERS TO EVALUATE:
{list_of_active_qqp_definitions}

For each QQP, extract its value from the plan data. Then compute the finishing coefficient.

Return ONLY valid JSON:

{
  "qqp_values": {
    "qqp_name": {"value": 0, "confidence": 0.0, "notes": ""}
  },
  "finishing_assessment": {
    "level": "basic|standard|comfort|luxury|premium",
    "coefficient": 1.00,
    "confidence": 0.0,
    "reasoning": "explanation",
    "strongest_indicators": [],
    "weakest_indicators": []
  },
  "new_qqp_suggestions": [
    {
      "name": "snake_case_name",
      "description": "what it measures",
      "reasoning": "why it might correlate with finishing level"
    }
  ]
}

RULES:
- For boolean QQPs, set value to true/false
- For numeric QQPs, compute the exact value from the plan data
- For ratio QQPs, compute from the available data
- Set confidence based on how certain you are about the extraction
- The finishing coefficient should be between 0.70 and 1.50
- ALWAYS suggest new QQP ideas in new_qqp_suggestions if you notice anything that might correlate with finishing level but isn't in the current QQP list

Return ONLY the JSON. No markdown, no explanation.`;

type QQPDef = {
  name: string;
  display_name: string;
  description: string | null;
  data_type: string;
  unit: string | null;
};

type KnownData = {
  knownPricePerSqm: number | null;
  knownCoefficient: number | null;
  expertNotes: string | null;
};

export function buildQQPUserPrompt(
  sqmExtraction: Record<string, unknown>,
  qqpDefs: QQPDef[],
  knownData?: KnownData
): string {
  const qqpList = qqpDefs
    .map(
      (d) =>
        `- ${d.name} (${d.data_type}${d.unit ? `, unit: ${d.unit}` : ""}): ${d.description ?? d.display_name}`
    )
    .join("\n");

  let prompt = QQP_USER_PROMPT_TEMPLATE
    .replace("{sqm_extraction_json}", JSON.stringify(sqmExtraction, null, 2))
    .replace("{list_of_active_qqp_definitions}", qqpList);

  if (knownData) {
    prompt += "\n\nKNOWN DATA FOR THIS DOSSIER:\n";
    if (knownData.knownPricePerSqm != null)
      prompt += `- Known price/m²: €${knownData.knownPricePerSqm}\n`;
    if (knownData.knownCoefficient != null)
      prompt += `- Known finishing coefficient: ${knownData.knownCoefficient}\n`;
    if (knownData.expertNotes)
      prompt += `- Expert notes: ${knownData.expertNotes}\n`;
    prompt +=
      '\nAfter your QQP extraction, also return a "training_feedback" block as described in your instructions.';
  }

  return prompt;
}

export const STRICT_JSON_RETRY_MESSAGE =
  "You MUST return ONLY valid JSON. No markdown, no backticks, no explanation. Start with { and end with }.";

function cleanJsonText(text: string): string {
  let s = text.trim();
  // Strip markdown code fences
  s = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/g, "");
  s = s.trim();
  // Extract from first { to last } to tolerate leading/trailing prose
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s;
}

export function parseClaudeJson(text: string): unknown {
  return JSON.parse(cleanJsonText(text));
}
