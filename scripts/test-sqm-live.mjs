/**
 * test-sqm-live.mjs — run the ACTUAL live SQM extraction prompt on a local plan
 * PDF and compare the extracted bruto-per-floor to the expert berekening.
 * Diagnoses WHERE SQM goes wrong (net vs bruto, circulation, missed floors).
 *
 * Usage: node scripts/test-sqm-live.mjs <pdfpath> <pageIdxCsv>
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const AKEY = env.ANTHROPIC_API_KEY;
const PLAN = process.argv[2];
const PAGE_IDX = (process.argv[3] || "").split(",").filter(Boolean).map(Number);

// fetch live SQM prompt
const pv = (await (await fetch(`${U}/rest/v1/prompt_versions?prompt_type=eq.sqm_extraction&is_active=eq.true&select=system_prompt,user_template`, { headers: H })).json())[0];
let userPrompt = (pv.user_template || "").replace(/\{[^}]+\}/g, "").trim();
if (!userPrompt) userPrompt = "Extract the bruto floor area per building per floor from these plan images. Return JSON.";

// render pages
const buf = readFileSync(PLAN);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const idx = PAGE_IDX.length ? PAGE_IDX : Array.from({ length: Math.min(doc.countPages(), 6) }, (_, i) => i);
const mat = mupdf.Matrix.scale(96 / 72, 96 / 72); // 96 DPI for plan detail
const images = [];
for (const i of idx) {
  if (i >= doc.countPages()) continue;
  const b64 = Buffer.from(doc.loadPage(i).toPixmap(mat, mupdf.ColorSpace.DeviceRGB, false, true).asPNG()).toString("base64");
  if (b64.length < 4_800_000) images.push(b64); else console.error(`page ${i} too big, skipped`);
}
console.error(`Rendered ${images.length} pages @96dpi`);

const content = [
  { type: "text", text: userPrompt + "\n\n(Analyze the attached floor plan images. Return the structured JSON result.)" },
  ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } })),
];
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 8000, system: pv.system_prompt, messages: [{ role: "user", content }] }),
});
const j = await res.json();
if (!res.ok) { console.error("API error", JSON.stringify(j).slice(0, 300)); process.exit(1); }
const txt = j.content?.[0]?.text || "";

// try to parse JSON
const m = txt.match(/\{[\s\S]*\}/);
let parsed = null;
try { parsed = JSON.parse(m[0]); } catch {}
if (parsed) {
  console.log(JSON.stringify(parsed, null, 1).slice(0, 6000));
} else {
  console.log(txt.slice(0, 6000));
}
