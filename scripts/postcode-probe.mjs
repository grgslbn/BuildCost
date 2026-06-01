import * as mupdf from "mupdf"; import sharp from "sharp"; import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {}; for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const AKEY = env.ANTHROPIC_API_KEY; const FILE = process.argv[2];
const doc = mupdf.Document.openDocument(readFileSync(FILE), "application/pdf");
// title block usually bottom-right; render full page + a bottom-right crop
async function imgs(p){const pix=doc.loadPage(p).toPixmap(mupdf.Matrix.scale(200/72,200/72),mupdf.ColorSpace.DeviceRGB,false,true);const full=Buffer.from(pix.asPNG());const W=pix.getWidth(),H=pix.getHeight();
 const over=await sharp(full).resize({width:1568,height:1568,fit:"inside",withoutEnlargement:true}).png().toBuffer();
 const br=await sharp(full).extract({left:Math.floor(W*0.6),top:Math.floor(H*0.6),width:Math.floor(W*0.4),height:Math.floor(H*0.4)}).resize({width:1568,withoutEnlargement:true}).png().toBuffer();
 return [over.toString("base64"), br.toString("base64")];}
const SYS="You read the title block (cartouche) of a Belgian architect plan. Return ONLY JSON.";
const INSTR=`Read the project ADDRESS from the title block / cartouche. Return JSON: {"address":"...","postcode":"<4-digit Belgian postcode>","municipality":"...","note":"where you found it"}`;
async function vision(images){const content=[{type:"text",text:INSTR},...images.map(b=>({type:"image",source:{type:"base64",media_type:"image/png",data:b}}))];const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":AKEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:600,system:SYS,messages:[{role:"user",content}]})});const j=await res.json();if(!res.ok)throw new Error(JSON.stringify(j).slice(0,150));const m=(j.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null;}
for(const p of [1,0]){try{const r=await vision(await imgs(p));console.log(`p${p}:`,JSON.stringify(r));if(r&&r.postcode)break;}catch(e){console.log(`p${p} FOUT`,String(e.message).slice(0,100));}}
