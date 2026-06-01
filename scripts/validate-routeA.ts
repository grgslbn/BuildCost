/* Validate route A (vision area-table extraction) end-to-end vs heated-floor GT. */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import sharp from "sharp";
import { extractAreaTableViaVision } from "../src/lib/sqm/extract-area-table";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const AKEY = env.ANTHROPIC_API_KEY;
const DIR = "C:/Users/tieme/Mijn Drive/M²Value/field/SELECTION/selectie building";
const gt = JSON.parse(readFileSync("scripts/sqm-groundtruth.json", "utf8"));
const files = readdirSync(DIR).filter((f) => /Verzamel.*\.pdf$/i.test(f) && !/kopie/i.test(f)).slice(0, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deltas: number[] = [];
let n = 0, within10 = 0;
async function main() {
console.log("dossier        cat1   heated-GT   Δ");
for (const f of files) {
  const ref = (f.match(/^(\d{2}-\d{6})/) || [])[1];
  if (!gt[ref]) continue;
  const buf = readFileSync(join(DIR, f));
  let text = ""; try { text = execSync(`pdftotext -layout "${join(DIR, f)}" -`, { encoding: "utf8", maxBuffer: 9e7 }); } catch { continue; }
  const doc = mupdf.Document.openDocument(buf, "application/pdf");

  const renderPages = async (pages1: number[]) => {
    const out: string[] = [];
    for (const p of pages1) {
      const pix = doc.loadPage(p - 1).toPixmap(mupdf.Matrix.scale(170 / 72, 170 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      let png: Buffer = Buffer.from(pix.asPNG()); let w = pix.getWidth();
      while (png.length > 3_600_000 && w > 1400) { w = Math.floor(w * 0.82); png = await sharp(Buffer.from(pix.asPNG())).resize({ width: w }).png().toBuffer(); }
      if (png.length <= 3_900_000) out.push(png.toString("base64"));
    }
    return out;
  };
  const visionJson = async ({ system, text: instr, imagesB64 }: { system: string; text: string; imagesB64: string[] }) => {
    await sleep(1200);
    const content = [{ type: "text", text: instr }, ...imagesB64.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: b } }))];
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 3000, system, messages: [{ role: "user", content }] }) });
    if (!res.ok) return null;
    const j = await res.json(); const m = (j.content?.[0]?.text || "").match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  };

  const r = await extractAreaTableViaVision(text, renderPages, visionJson);
  const heated = gt[ref].heated_m2;
  const d = r.found && heated ? r.areas.cat1 / heated - 1 : null;
  if (d != null) { n++; deltas.push(Math.abs(d)); if (Math.abs(d) <= 0.10) within10++; }
  console.log(ref.padEnd(13) + String(Math.round(r.areas.cat1)).padStart(6) + String(Math.round(heated)).padStart(12) + "   " + (d != null ? (d >= 0 ? "+" : "") + (d * 100).toFixed(0) + "%" : "geen tabel"));
}
const med = deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
console.log(`\n══ ROUTE A (vision area-table) ══  n=${n}  mediaan-|Δ| ${med != null ? (med * 100).toFixed(0) : "-"}%  binnen 10%: ${within10}/${n}`);
}
main();
