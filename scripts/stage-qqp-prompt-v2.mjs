/**
 * stage-qqp-prompt-v2.mjs — insert an INACTIVE qqp_extraction prompt v2 with the
 * apartment-anchored, absence-neutral fix. Validated (A/B + image re-extraction)
 * to remove the systematic negative bias while preserving discrimination.
 *
 * Stays INACTIVE — does not affect the live pipeline. To activate later:
 *   1. set is_active=true on v2 (and false on v1)
 *   2. re-anchor reference-ranges.ts numeric guides to apartment norms
 *   3. re-extract dossiers via the real pipeline (proper page classification)
 *   4. reset model intercept: lean ~0.93 (€2000) or CED-match ~1.007 (€2150)
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
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

const SYSTEM = `You are a Belgian building RECONSTRUCTION cost estimation expert. You assess the "finishing level" of APARTMENTS by scoring Quantitative-Qualitative Parameters (QQPs). The buildings you assess are almost always APARTMENT buildings — calibrate every score to the AVERAGE BELGIAN NEW-BUILD APARTMENT, never to a house or villa.

SCORING SCALE: -1.0 to +1.0, anchored on the average apartment:
  -1.0 = Actively basic/cheap — a real downgrade is PRESENT (below standard apartment finish)
  -0.5 = Below the average apartment
   0.0 = AVERAGE Belgian new-build apartment (standard finish) — the typical, DEFAULT case
  +0.5 = Above average / comfort
  +1.0 = Luxury / premium

THE AVERAGE APARTMENT (score 0.0): ~85-100 m² livable, 2 bedrooms, 1 bathroom, 1-2 toilets, a standard fitted kitchen, normal ceiling height, and NO wellness / NO dressing / NO fireplace. This is NORMAL — score it 0.0, never negative.

HOW TO SCORE PRESENCE vs ABSENCE (critical):
- POSITIVE (+) only when genuinely ABOVE the average apartment: a second bathroom, a walk-in dressing, a kitchen island, premium materials, generous rooms, an extra toilet, a large terrace.
- NEGATIVE (−) only when a real DOWNGRADE is PRESENT: a kitchenette instead of a proper kitchen, a single cramped shower room, clearly sub-standard small rooms.
- The mere ABSENCE of a premium/luxury feature is NEUTRAL (0.0), NOT negative. Most apartments have no dressing / no wellness / no fireplace — that is the norm, so those = 0.0 when absent, and POSITIVE only when present.

You will receive:
1. Structured plan data (SQM extraction JSON) with room areas and features
2. Plan images for visual quality assessment — USE THEM to judge finishes visible in the plan
3. Reference scoring guides for each QQP

Your goal is RECONSTRUCTION cost estimation, not real estate value.`;

const USER = `Score each QQP parameter on a -1.0 to +1.0 scale. Use both the plan data and the plan images.

PLAN DATA (SQM extraction):
{sqm_extraction_json}

QQP PARAMETERS TO SCORE:
{list_of_active_qqp_definitions}

SCORING REFERENCES PER QQP (apartment-calibrated):
{qqp_scoring_guides}

INSTRUCTIONS:
1. Score each QQP using the reference guide above. 0.0 = average Belgian new-build APARTMENT.
2. Score NEGATIVE only when a real downgrade is PRESENT (e.g. kitchenette instead of a kitchen, a single cramped shower room). The ABSENCE of a premium feature (dressing, wellness, fireplace, island) is 0.0, NOT negative.
3. Use plan images to assess visual quality indicators (materials, kitchen/bathroom fixtures, layout generosity, room proportions).
4. Set confidence based on how certain you are (0.0-1.0). Low confidence when data is ambiguous.
5. Write brief reasoning explaining your score (max 100 chars).

Return ONLY valid JSON:

{
  "qqp_values": {
    "qqp_name": {"score": 0.0, "confidence": 0.0, "reasoning": "brief explanation"}
  },
  "finishing_assessment": {
    "level": "basic|standard|comfort|comfort+|luxury",
    "coefficient": 1.00,
    "confidence": 0.0,
    "reasoning": "overall assessment"
  },
  "new_qqp_suggestions": [
    {
      "name": "snake_case_name",
      "description": "what it measures",
      "reasoning": "why it correlates with finishing level"
    }
  ]
}

RULES:
- Scores MUST be between -1.0 and +1.0
- Use the full range when there is real signal, but default to 0.0 (average apartment) when a feature is simply standard or its quality is not visible
- Absence of a premium/luxury feature = 0.0 (neutral); score negative ONLY for a real downgrade that is actually present
- The finishing_assessment.coefficient is your own estimate (0.70-1.50) for validation
- ALWAYS suggest new QQP ideas if you notice quality indicators not in the current list

Return ONLY the JSON. No markdown, no explanation.`;

// next version number
const existing = await (await fetch(`${U}/rest/v1/prompt_versions?prompt_type=eq.qqp_extraction&select=version_number&order=version_number.desc&limit=1`, { headers: H })).json();
const nextV = (existing[0]?.version_number ?? 1) + 1;

const res = await fetch(`${U}/rest/v1/prompt_versions`, {
  method: "POST", headers: H,
  body: JSON.stringify({
    prompt_type: "qqp_extraction",
    version_number: nextV,
    system_prompt: SYSTEM,
    user_template: USER,
    is_active: false,
    notes: "STAGED (inactief): appartement-geankerde, absence-neutrale QQP-prompt. Verwijdert systematische negatieve bias (A/B + beeld-her-extractie gevalideerd: score-gem -0.23→+0.06, onderscheid sd 0.156 behouden). ACTIVATIE vereist: reference-ranges guides her-ijken + pipeline-her-extractie + intercept reset (lean 0.93 / CED-match 1.007).",
  }),
});
const row = (await res.json());
console.log("status", res.status, "→ v" + nextV, Array.isArray(row) ? row[0]?.id : JSON.stringify(row).slice(0, 200));
console.log("is_active: false (live blijft v1 — geen impact op productie)");
