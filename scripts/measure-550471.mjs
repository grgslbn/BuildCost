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
async function tiles(p, G=3){const pix=doc.loadPage(p).toPixmap(mupdf.Matrix.scale(230/72,230/72),mupdf.ColorSpace.DeviceRGB,false,true);const full=Buffer.from(pix.asPNG());const W=pix.getWidth(),H=pix.getHeight(),OV=0.1,out=[];for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){const left=Math.max(0,Math.floor((gx/G-OV)*W)),top=Math.max(0,Math.floor((gy/G-OV)*H));const w=Math.min(W-left,Math.ceil((1/G+2*OV)*W)),h=Math.min(H-top,Math.ceil((1/G+2*OV)*H));let png=await sharp(full).extract({left,top,width:w,height:h}).png().toBuffer();if(Math.max(w,h)>1600)png=await sharp(png).resize(w>=h?{width:1568}:{height:1568}).png().toBuffer();if(png.length<=3.7e6)out.push(png.toString("base64"));}return out;}
async function call(sys,instr,imgs,mt=1200){await sleep(900);const content=[{type:"text",text:instr},...imgs.map(b=>({type:"image",source:{type:"base64",media_type:"image/png",data:b}}))];for(let a=0;a<4;a++){const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":AKEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:mt,system:sys,messages:[{role:"user",content}]})});if(res.status===429||res.status>=500){await sleep(5000*(a+1));continue;}const j=await res.json();if(!res.ok)throw new Error(JSON.stringify(j).slice(0,150));const m=(j.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null;}return null;}
const FSYS="You read the OUTER overall building dimensions off a Belgian floor-plan sheet. You read numbers only. Return ONLY JSON.";
const FINSTR=`These overlapping tiles are ONE floor-plan sheet. Read the building's OUTER overall width and depth (the outermost dimension chain). If two separate buildings/wings are shown, give each. Return JSON: {"buildings":[{"label":"...","overall_width_m":<n>,"overall_depth_m":<n>,"footprint_m2":<n>}],"note":"..."}`;
const CSYS="You count floor levels on a Belgian building section/elevation. Return ONLY JSON.";
const CINSTR=`These tiles show building ELEVATIONS/SECTIONS. Count the stacked floor levels. Return JSON: {"total_levels":<int>,"heated_levels":<int>,"basement_levels":<int>,"note":"which levels (e.g. kelder + gvl + 3 verdiepingen)"}`;

const GT=2126;
// footprint from gelijkvloers (p0) and a typical verdieping (p1)
const fp0 = await call(FSYS,FINSTR,await tiles(0));
const fp1 = await call(FSYS,FINSTR,await tiles(1));
const cnt = await call(CSYS,CINSTR,await tiles(4),700);
const sum=(o)=> (o?.buildings||[]).reduce((s,b)=>s+(+b.footprint_m2|| (+b.overall_width_m*+b.overall_depth_m)||0),0);
const gvl=sum(fp0), typ=sum(fp1);
console.log("gelijkvloers footprint:", Math.round(gvl), JSON.stringify(fp0?.buildings));
console.log("type-verdieping footprint:", Math.round(typ), JSON.stringify(fp1?.buildings));
console.log("verdieping-telling:", JSON.stringify(cnt));
const heated = cnt?.heated_levels || 0;
// estimate: gelijkvloers + typical × (heated-1)
const est = gvl + typ*Math.max(0,heated-1);
console.log(`\n26-550471 GT heated ${GT} → FOOTPRINT×LAGEN est=${Math.round(est)} (${((est/GT-1)*100).toFixed(0)}%)  [gvl ${Math.round(gvl)} + typ ${Math.round(typ)}×${Math.max(0,heated-1)}]`);
