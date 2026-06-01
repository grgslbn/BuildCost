import * as mupdf from "mupdf";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const AKEY = env.ANTHROPIC_API_KEY;
const FILE = "C:/Users/tieme/Desktop/testing 30_5/25-5475630plannen.pdf";
const doc = mupdf.Document.openDocument(readFileSync(FILE), "application/pdf");
async function tiles(p) {
  const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(200/72,200/72), mupdf.ColorSpace.DeviceRGB,false,true);
  const full = Buffer.from(pix.asPNG()); const W=pix.getWidth(),H=pix.getHeight(); const G=3,OV=0.1,out=[];
  for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){const left=Math.max(0,Math.floor((gx/G-OV)*W)),top=Math.max(0,Math.floor((gy/G-OV)*H));const w=Math.min(W-left,Math.ceil((1/G+2*OV)*W)),h=Math.min(H-top,Math.ceil((1/G+2*OV)*H));let png=await sharp(full).extract({left,top,width:w,height:h}).png().toBuffer();if(Math.max(w,h)>1600)png=await sharp(png).resize(w>=h?{width:1568}:{height:1568}).png().toBuffer();if(png.length<=3.7e6)out.push(png.toString("base64"));}
  return out;
}
const SYS="You inspect Belgian architect floor-plan tiles and report what areal information is present. Return ONLY JSON.";
const INSTR=`These are overlapping tiles of ONE A0 floor-plan sheet. Tell me what's usable for computing floor area:
{"sheet_type":"floor_plan|section|elevation|site|other","floor_label":"...",
 "has_printed_unit_areas":<bool>,"unit_area_examples":["app X 104 m²", ...up to 6],
 "has_printed_room_areas":<bool>,"room_area_examples":[...up to 6],
 "has_dimension_chains":<bool>,"has_overall_building_dims":<bool>,"overall_width_m":<n|null>,"overall_depth_m":<n|null>,
 "n_units_visible":<int>,"legible":"high|med|low","note":"what you see"}`;
async function vision(imgs){const content=[{type:"text",text:INSTR},...imgs.map(b=>({type:"image",source:{type:"base64",media_type:"image/png",data:b}}))];const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":AKEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1500,system:SYS,messages:[{role:"user",content}]})});const j=await res.json();if(!res.ok)throw new Error(JSON.stringify(j).slice(0,200));const m=(j.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null;}
for(const p of [1,3,5]){
  try{const r=await vision(await tiles(p));console.log(`\n=== pagina ${p} ===`);console.log(JSON.stringify(r,null,1));}catch(e){console.log(`p${p} FOUT`,String(e.message).slice(0,150));}
  await new Promise(r=>setTimeout(r,1200));
}
