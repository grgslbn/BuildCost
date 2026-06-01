/**
 * test-sqm-crops.mjs — test the resolution/cropping hypothesis: render ONE plan
 * sheet at high DPI, crop into vertical strips (one floor plan each), run the
 * live SQM prompt, and see if the model reads dimensions confidently.
 * Usage: node scripts/test-sqm-crops.mjs <pdf> <pageIdx> <nStrips>
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const AKEY = env.ANTHROPIC_API_KEY;
const PLAN = process.argv[2];
const PAGE = parseInt(process.argv[3] || "3", 10);
const N = parseInt(process.argv[4] || "3", 10);

const pv = (await (await fetch(`${U}/rest/v1/prompt_versions?prompt_type=eq.sqm_extraction&is_active=eq.true&select=system_prompt,user_template`, { headers: H })).json())[0];

const buf = readFileSync(PLAN);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const pix = doc.loadPage(PAGE).toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
const full = Buffer.from(pix.asPNG());
const W = pix.getWidth(), Hh = pix.getHeight();
console.error(`page ${PAGE} @200dpi: ${W}x${Hh}`);

// crop into N overlapping vertical strips
const images = [];
const stripW = Math.floor(W / N * 1.12); // slight overlap
for (let s = 0; s < N; s++) {
  const left = Math.min(Math.floor(W / N * s), W - stripW);
  let crop = await sharp(full).extract({ left: Math.max(0, left), top: 0, width: Math.min(stripW, W - left), height: Hh }).png().toBuffer();
  if (crop.length > 4_800_000) crop = await sharp(crop).resize({ width: 3000 }).png().toBuffer();
  images.push(crop.toString("base64"));
  console.error(`  strip ${s}: ${(crop.length / 1024 / 1024).toFixed(2)}MB`);
}

const content = [
  { type: "text", text: (pv.user_template || "").replace(/\{[^}]+\}/g, "").trim() + `\n\nThese ${N} images are vertical strips of ONE sheet, each showing ONE floor plan of the SAME building block (left=ground floor, then up). Read the outer-wall dimension chains. Return JSON with per-floor bruto m² and the measurement method used per floor.` },
  ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } })),
];
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 6000, system: pv.system_prompt, messages: [{ role: "user", content }] }),
});
const j = await res.json();
if (!res.ok) { console.error("API", JSON.stringify(j).slice(0, 300)); process.exit(1); }
const txt = j.content?.[0]?.text || "";
const m = txt.match(/\{[\s\S]*\}/);
try { console.log(JSON.stringify(JSON.parse(m[0]), null, 1).slice(0, 5000)); }
catch { console.log(txt.slice(-4000)); }
