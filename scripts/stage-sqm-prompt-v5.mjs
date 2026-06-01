/**
 * stage-sqm-prompt-v5.mjs — insert an INACTIVE sqm_extraction prompt v5 that adds
 * the two techniques validated on the selectie-building benchmark:
 *   1. SEGMENT-SUM width/depth (read+add the dimension segments along each outer
 *      edge — don't hunt for a single "total" dimension). Validated: −3% on a
 *      clean dossier when all floors captured.
 *   2. FLOOR ENUMERATION (count ALL levels from the section + floor titles; multiply
 *      a typical floor by its repeat count). This is the #1 SQM error source —
 *      tall buildings under-counted because typical floors are drawn once.
 * Stays INACTIVE (v4 remains live). Activate + validate via the pipeline.
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

const v4 = (await (await fetch(`${U}/rest/v1/prompt_versions?prompt_type=eq.sqm_extraction&is_active=eq.true&select=system_prompt,user_template,version_number`, { headers: H })).json())[0];

const ADDITION = `

═══════════════════════════════════════════════════════════════════════════
TWO CRITICAL TECHNIQUES (benchmark-validated 2026-05-31, selectie building)
═══════════════════════════════════════════════════════════════════════════

【A】 WIDTH/DEPTH = SUM THE SEGMENTS (do NOT hunt for one "total" dimension)
Belgian dimension chains break the outer wall into segments. Do NOT try to decide
which single number is the building total — you will guess wrong.
INSTEAD: read EVERY segment along the outer TOP edge and ADD them = WIDTH.
Read every segment along the outer LEFT (or right) edge and ADD them = DEPTH.
  footprint = WIDTH × DEPTH.
Example: top-edge segments "397 230 150 473" cm → 397+230+150+473 = 1250 cm = 12.50 m.
This is reading + addition (reliable), not interpretation. State the segments you summed.

【B】 ENUMERATE EVERY FLOOR — MISSING FLOORS IS THE #1 ERROR
The bruto building total = the sum over ALL levels. Under-counting floors is the
single largest source of error (a 10-storey building scored as 2 floors = −75%).
  1. Count the levels TWO ways and reconcile: (a) the SECTION / elevation drawing
     shows all levels stacked and labeled (-1, +0, +1 … +N); (b) the floor-plan
     titles (Kelder, Gelijkvloers, 1e verdieping, +3, Nivo 2 …).
  2. If a TYPICAL floor is drawn only once but the building has several identical
     storeys, MULTIPLY that footprint by the number of identical storeys.
  3. A tall building with only a few plan sheets STILL has all its floors.
  4. In your output, ALWAYS state n_levels and list which level each area belongs to;
     if measured floors < n_levels from the section, you are missing floors — fix it.

These two techniques OVERRIDE any conflicting guidance above when they apply.`;

const SYSTEM = v4.system_prompt + ADDITION;
const next = (v4.version_number || 4) + 1;

const res = await fetch(`${U}/rest/v1/prompt_versions`, {
  method: "POST", headers: H,
  body: JSON.stringify({
    prompt_type: "sqm_extraction",
    version_number: next,
    system_prompt: SYSTEM,
    user_template: v4.user_template,
    is_active: false,
    notes: "STAGED (inactief): v4 + 2 benchmark-gevalideerde technieken — (A) segment-som voor breedte/diepte, (B) verdieping-enumeratie (×aantal identieke verdiepingen; #1 foutbron). Activeren + valideren via pipeline. Zie docs/benchmark-2026-05-31.md.",
  }),
});
const row = await res.json();
console.log("status", res.status, "→ sqm v" + next, Array.isArray(row) ? row[0]?.id : JSON.stringify(row).slice(0, 200), "(inactief, v4 blijft live)");
