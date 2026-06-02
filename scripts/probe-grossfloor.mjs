import * as mupdf from "mupdf"; import sharp from "sharp"; import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {}; for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const AKEY = env.ANTHROPIC_API_KEY; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tiles(file,p){const doc=mupdf.Document.openDocument(readFileSync(file),"application/pdf");const pix=doc.loadPage(p).toPixmap(mupdf.Matrix.scale(230/72,230/72),mupdf.ColorSpace.DeviceRGB,false,true);const full=Buffer.from(pix.asPNG());const W=pix.getWidth(),H=pix.getHeight(),G=3,OV=0.1,out=[];for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){const left=Math.max(0,Math.floor((gx/G-OV)*W)),top=Math.max(0,Math.floor((gy/G-OV)*H));const w=Math.min(W-left,Math.ceil((1/G+2*OV)*W)),h=Math.min(H-top,Math.ceil((1/G+2*OV)*H));let png=await sharp(full).extract({left,top,width:w,height:h}).png().toBuffer();if(Math.max(w,h)>1600)png=await sharp(png).resize(w>=h?{width:1568}:{height:1568}).png().toBuffer();if(png.length<=3.7e6)out.push(png.toString("base64"));}return out;}
const SYS="You estimate the GROSS heated floor area of ONE apartment floor from its plan (tiles). Return ONLY JSON.";
const INSTR=`This is ONE residential floor. The apartments have printed m² labels; the common circulation (traphal/lift/hal/SAS) is drawn but usually has NO m². 
1) Sum the printed apartment areas (apartments_sum_m2).
2) Estimate the GROSS heated floor of this level = apartments + common circulation + interior walls, by also accounting for the visible circulation cores and wall thickness (gross_floor_m2). Use the outer building dimensions / grid if visible to bound it.
3) Estimate the common+walls overhead as a fraction of apartments (overhead_fraction).
Return JSON: {"apartments_sum_m2":<n>,"gross_floor_m2":<n>,"overhead_fraction":<n>,"used_outer_dims":<bool>,"note":"..."}`;
async function vision(imgs){await sleep(800);const content=[{type:"text",text:INSTR},...imgs.map(b=>({type:"image",source:{type:"base64",media_type:"image/png",data:b}}))];const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":AKEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1200,system:SYS,messages:[{role:"user",content}]})});const j=await res.json();if(!res.ok)throw new Error(JSON.stringify(j).slice(0,150));const m=(j.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null;}
const cases=[
 ["23-499978 Niveau 0","C:/Users/tieme/Desktop/testing 1_6/23-49997800plannen.pdf",6,905.79],
 ["23-499974 Gelijkvloers","C:/Users/tieme/Desktop/testing 1_6/23-4999740plannen.pdf",1,233],
];
for(const [name,file,p,gt] of cases){try{const r=await vision(await tiles(file,p));const d=v=>v?((v/gt-1)*100).toFixed(0)+"%":"—";console.log(`${name} (expert heated ${gt}): app_sum=${Math.round(r.apartments_sum_m2||0)} gross_est=${Math.round(r.gross_floor_m2||0)} (Δ${d(r.gross_floor_m2)}) overhead=${r.overhead_fraction} outerdims=${r.used_outer_dims}`);console.log(`   note: ${(r.note||'').slice(0,150)}`);}catch(e){console.log(`${name} FOUT`,String(e.message).slice(0,90));}}
