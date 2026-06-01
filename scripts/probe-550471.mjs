import * as mupdf from "mupdf";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const AKEY = env.ANTHROPIC_API_KEY;
const FILE = "C:/Users/tieme/Desktop/testing 30_5/26-550471plannen.pdf";
const doc = mupdf.Document.openDocument(readFileSync(FILE), "application/pdf");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function overview(p) {
  const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(150/72,150/72), mupdf.ColorSpace.DeviceRGB,false,true);
  let png = Buffer.from(pix.asPNG());
  png = await sharp(png).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return png.toString("base64");
}
const SYS="You classify Belgian building plan sheets and report what areal info is present. Return ONLY JSON.";
const INSTR=`What is on this single plan sheet? Return JSON:
{"sheet_type":"floor_plan|section|elevation|site|title|detail|other","floor_label":"...","scanned_or_cad":"scanned|cad",
 "has_printed_areas":<bool>,"area_examples":["leefruimte 30 m²", ...up to 5],"has_dimensions":<bool>,"legible":"high|med|low","note":"short"}`;
async function vision(b64){const content=[{type:"text",text:INSTR},{type:"image",source:{type:"base64",media_type:"image/png",data:b64}}];const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":AKEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:900,system:SYS,messages:[{role:"user",content}]})});const j=await res.json();if(!res.ok)throw new Error(JSON.stringify(j).slice(0,150));const m=(j.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null;}
for(let p=0;p<doc.countPages();p++){
  try{const r=await vision(await overview(p));console.log(`p${p}: ${r.sheet_type} [${r.floor_label||''}] ${r.scanned_or_cad} | areas:${r.has_printed_areas} dims:${r.has_dimensions} ${r.legible}` + (r.area_examples?.length?` | ${r.area_examples.slice(0,4).join("; ")}`:""));}catch(e){console.log(`p${p} FOUT ${String(e.message).slice(0,80)}`);}
  await sleep(900);
}
