/**
 * bench-qqp.mjs — run v2 (apartment-anchored) QQP extraction on each dossier's
 * floor plans, output the weighted-score → so we can calibrate scale+intercept
 * against the expert required-F (from bench-experts.json).
 * Writes scripts/bench-qqp.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
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
const DIR = "C:/Users/tieme/Desktop/testing 30_5";

const experts = JSON.parse(readFileSync("scripts/bench-experts.json", "utf8"));
const model = (await (await fetch(`${U}/rest/v1/qqp_model_versions?is_active=eq.true&select=weights`, { headers: H })).json())[0];
const W = model.weights;
const v2 = (await (await fetch(`${U}/rest/v1/prompt_versions?prompt_type=eq.qqp_extraction&version_number=eq.2&select=system_prompt`, { headers: H })).json())[0].system_prompt;

const GUIDES = {
  total_livable_sqm:"apt:<50=-1,70=-0.5,90=0,140=+0.5,200+=+1",bedroom_count:"1=-0.3,2=0,3=+0.3,4=+0.6",bathroom_count:"1=0,2=+0.5,3=+0.8,4+=+1",toilet_count:"1=-0.1,2=+0.2,3=+0.6",kitchen_sqm:"<5=-1,7=-0.5,9=0,13=+0.5,18+=+1;kitchenette=-1",living_room_sqm:"<18=-1,24=-0.5,30=0,42=+0.5,55+=+1",master_bedroom_sqm:"<9=-1,11=-0.5,13=0,17=+0.5,24+=+1",avg_bedroom_sqm:"<8=-1,9.5=-0.5,11=0,14=+0.5,19+=+1",largest_bathroom_sqm:"<3=-1,4=-0.5,6=0,9=+0.5,13+=+1",bathroom_luxury_score:"standard=0;basic shower=-0.5,bath+shower=+0.4,jacuzzi/double=+1",bathroom_per_bedroom_ratio:"0.33=-0.3,0.5=0,0.67=+0.4,1+=+1",kitchen_appliance_count:"standard=0;none=-1,well=+0.5,premium=+1",has_kitchen_island:"absent=0,island=+0.6",has_open_kitchen:"closed=0,open=+0.4",has_fireplace:"absent=0,present=+0.5",has_dressing:"absent=0,present=+0.7,large=+1",has_wellness:"absent=0,sauna/spa=+0.8",has_separate_dining:"absent=0,separate=+0.5",has_office:"absent=0,office=+0.5",has_laundry_room:"absent=0,utility=+0.4",has_basement:"absent=0,cellar=+0.3",has_garage:"absent=0,garage=+0.3",built_in_storage_count:"none=0,some=+0.3,many=+0.6,extensive=+1",entrance_hall_sqm:"<2=-1,3=-0.5,5=0,8=+0.5,12+=+1",circulation_ratio:"<8%=-0.5,12%=0,18%=+0.5",terrace_balcony_sqm:"none=0,12=+0.4,25=+0.7,40+=+1",garage_sqm:"none=0,box15=+0.3,25=+0.5,40+=+0.8",floor_count:"2-3=0,4-5=+0.2,6-8=+0.4,9+=+0.6",living_to_total_ratio:"20-30%=0",wet_room_to_total_ratio:"15%=0,20%=+0.3,25%+=+0.6",outdoor_to_indoor_ratio:"0=0,10%=+0.3,20%+=+0.6",avg_room_size:"<12=-0.5,16=0,22=+0.5,30+=+1",
};
const QQP_NAMES = Object.keys(W).filter((k) => !k.startsWith("_"));
const guidesText = QQP_NAMES.map((q) => `- ${q}: ${GUIDES[q] || "average=0"}`).join("\n");

// pick the densest non-berekening floor-plan pages
function pickPages(buf, file) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const n = doc.countPages();
  const t = execSync(`pdftotext -layout "${join(DIR, file)}" -`, { encoding: "utf8", maxBuffer: 8e7 });
  const pageTexts = t.split("\f");
  const sizes = [];
  for (let i = 0; i < n; i++) {
    // skip berekening/cover pages (text-heavy with total markers, or very little graphics)
    if (/Totaal kapitaal|NIEUWBOUWWAARDE|Vertrouwelijke Beoordeling|Situatieschema/i.test(pageTexts[i] || "")) continue;
    try {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(50 / 72, 50 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      sizes.push({ i, size: Buffer.from(pix.asPNG()).length });
    } catch {}
  }
  return sizes.sort((a, b) => b.size - a.size).slice(0, 3).map((s) => s.i);
}

async function renderHi(buf, idx) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (const i of idx) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    let png = Buffer.from(pix.asPNG());
    let width = pix.getWidth();
    // iteratively downscale until comfortably under the 5MB base64-decoded limit (~3.6MB raw)
    while (png.length > 3_600_000 && width > 1400) {
      width = Math.floor(width * 0.8);
      png = await sharp(Buffer.from(pix.asPNG())).resize({ width }).png().toBuffer();
    }
    if (png.length <= 3_900_000) out.push(png.toString("base64"));
    else console.error(`  page ${i} still too big (${(png.length/1e6).toFixed(1)}MB), skipped`);
  }
  return out;
}

async function runQQP(ctx, images) {
  const content = [{ type: "text", text: `Score each QQP for this apartment building's typical unit (-1..+1, 0=average apt). Use plan IMAGES + context.\nCONTEXT: ${ctx}\nQQPs:\n${guidesText}\nReturn ONLY JSON {"qqp_values":{"name":{"score":0}}}` },
    ...images.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, system: v2, messages: [{ role: "user", content }] }) });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 150));
  const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
  const raw = m ? JSON.parse(m[0]).qqp_values : {};
  const s = {}; for (const [k, v] of Object.entries(raw)) if (typeof v?.score === "number") s[k] = v.score;
  return s;
}
const wsum = (s) => Object.entries(s).reduce((a, [q, v]) => a + (W[q] ?? 0) * v, 0);
const reqF = (eur) => 0.70 + (eur - 1600) / 1300 * 0.80;

const out = [];
for (const e of experts) {
  if (e.building_type && /winkel|woning$/i.test(e.building_type)) { console.error(`${e.ref}: skip (${e.building_type})`); continue; }
  try {
    const buf = readFileSync(join(DIR, e.file));
    const idx = pickPages(buf, e.file);
    const imgs = await renderHi(buf, idx);
    const s = await runQQP(`Apartment building, expert woon €${e.woonEur}/m².`, imgs);
    const ws = wsum(s);
    out.push({ ref: e.ref, woonEur: e.woonEur, reqF: +reqF(e.woonEur).toFixed(3), wsum: +ws.toFixed(3), scores: s });
    console.error(`${e.ref}: woon €${e.woonEur} (reqF ${reqF(e.woonEur).toFixed(2)})  wsum ${ws.toFixed(3)}  pages ${idx}`);
  } catch (err) { console.error(`${e.ref}: FOUT ${err.message}`); }
}
writeFileSync("scripts/bench-qqp.json", JSON.stringify(out, null, 1));

// ── Calibrate scale + intercept: reqF = intercept + scale*wsum (least squares) ──
const n = out.length, sx = out.reduce((a, d) => a + d.wsum, 0), sy = out.reduce((a, d) => a + d.reqF, 0);
const sxx = out.reduce((a, d) => a + d.wsum * d.wsum, 0), sxy = out.reduce((a, d) => a + d.wsum * d.reqF, 0);
const scale = (n * sxy - sx * sy) / (n * sxx - sx * sx);
const intercept = (sy - scale * sx) / n;
console.log(`\n══ CALIBRATIE (reqF = intercept + scale·wsum, n=${n}) ══`);
console.log(`  scale = ${scale.toFixed(3)}   intercept = ${intercept.toFixed(3)}`);
console.log(`\n  dossier   woon€/m²  reqF   wsum   predF(new)  Δ€/m²`);
let mae = 0;
for (const d of out) {
  const pf = Math.max(0.70, Math.min(1.50, intercept + scale * d.wsum));
  const pe = Math.round(1600 + (pf - 0.70) / 0.80 * 1300);
  mae += Math.abs(pe - d.woonEur);
  console.log(`  ${d.ref}  €${d.woonEur}   ${d.reqF}  ${d.wsum.toFixed(2)}    ${pf.toFixed(2)} (€${pe})   ${pe - d.woonEur >= 0 ? "+" : ""}${pe - d.woonEur}`);
}
console.log(`\n  MAE €${Math.round(mae / out.length)}/m²  → scale ${scale.toFixed(2)} × huidige gewichten, intercept ${intercept.toFixed(3)}`);
