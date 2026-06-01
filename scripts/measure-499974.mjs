import * as mupdf from "mupdf"; import sharp from "sharp"; import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {}; for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const AKEY = env.ANTHROPIC_API_KEY; const FILE = "C:/Users/tieme/Desktop/testing 1_6/23-4999740plannen.pdf"; const sleep = ms => new Promise(r=>setTimeout(r,ms));
const doc = mupdf.Document.openDocument(readFileSync(FILE), "application/pdf");
const SYS="You read printed area labels off Belgian architect floor-plan tiles and categorise each. Tiles overlap → count each label once. Return ONLY JSON.";
const INSTR=`These overlapping TILES are ONE floor-plan sheet. Read EVERY printed area (e.g. "APP.0.1 Netto Vloeropp 67,3 m²", "P.7 16,8 m²", rooms, traphal/hal).
cat1=heated living incl common circulation (apartments, traphal, hal, inkom); cat2=parking/kelder/garage/berging ("P.x" parkeerplaats, kelderberging); cat3=terras/balkon; other=non-floor.
cat1_basis: "net" if the cat1 areas are NETTO (netto vloeropp / NO / excludes walls); "gross" if BRUTO/BO (includes walls); "mixed".
Return JSON: {"floor_label":"...","areas":[{"label":"...","m2":<n>,"cat":"cat1|cat2|cat3|other"}],"cat1_basis":"net|gross|mixed"}`;
async function tiles(p){const pix=doc.loadPage(p).toPixmap(mupdf.Matrix.scale(200/72,200/72),mupdf.ColorSpace.DeviceRGB,false,true);const full=Buffer.from(pix.asPNG());const W=pix.getWidth(),H=pix.getHeight(),G=3,OV=0.1,out=[];for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){const left=Math.max(0,Math.floor((gx/G-OV)*W)),top=Math.max(0,Math.floor((gy/G-OV)*H));const w=Math.min(W-left,Math.ceil((1/G+2*OV)*W)),h=Math.min(H-top,Math.ceil((1/G+2*OV)*H));let png=await sharp(full).extract({left,top,width:w,height:h}).png().toBuffer();if(Math.max(w,h)>1600)png=await sharp(png).resize(w>=h?{width:1568}:{height:1568}).png().toBuffer();if(png.length<=3.7e6)out.push(png.toString("base64"));}return out;}
async function vision(imgs){await sleep(800);const content=[{type:"text",text:INSTR},...imgs.map(b=>({type:"image",source:{type:"base64",media_type:"image/png",data:b}}))];for(let a=0;a<3;a++){const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":AKEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:3000,system:SYS,messages:[{role:"user",content}]})});if(res.status===429||res.status>=500){await sleep(5000*(a+1));continue;}const j=await res.json();if(!res.ok)throw new Error(JSON.stringify(j).slice(0,150));const m=(j.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null;}return null;}
const perFloor=new Map();
for(let p=0;p<doc.countPages();p++){try{const r=await vision(await tiles(p));if(!r||!Array.isArray(r.areas)){console.log(`p${p}: geen`);continue;}
 const s=c=>r.areas.filter(a=>a.cat===c).reduce((x,a)=>x+(+a.m2>0&&+a.m2<2000?+a.m2:0),0);
 const c1=s('cat1'),c2=s('cat2'),c3=s('cat3');const key=String(r.floor_label||p).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,14);
 const prev=perFloor.get(key);if(!prev||c1>prev.c1)perFloor.set(key,{c1,c2,c3,basis:r.cat1_basis,label:r.floor_label});
 console.log(`p${p} [${r.floor_label}] basis=${r.cat1_basis} cat1=${Math.round(c1)} cat2=${Math.round(c2)} cat3=${Math.round(c3)}`);
}catch(e){console.log(`p${p} FOUT ${String(e.message).slice(0,80)}`);}}
let nc1=0,dc1=0,dc2=0,dc3=0; doc; // naive = sum all pages already printed; dedup:
for(const v of perFloor.values()){dc1+=v.c1;dc2+=v.c2;dc3+=v.c3;}
const basis=[...perFloor.values()][0]?.basis||'?';const factor=basis==='net'?1.12:basis==='mixed'?1.06:1.0;
console.log(`\nUNIEKE verdiepingen: ${perFloor.size} (van ${doc.countPages()} bladen)`);
console.log(`DEDUP cat1=${Math.round(dc1)} (basis ${basis} → ×${factor} = ${Math.round(dc1*factor)}) cat2=${Math.round(dc2)} cat3=${Math.round(dc3)}`);
