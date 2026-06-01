import * as mupdf from "mupdf";
import sharp from "sharp";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const AKEY = env.ANTHROPIC_API_KEY;
const FILE = "C:/Users/tieme/Desktop/testing 30_5/25-5475630plannen.pdf";
const GT = 16783;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const doc = mupdf.Document.openDocument(readFileSync(FILE), "application/pdf");

// floor-plan pages by keyword (m² labels aren't extractable, so use plan keywords)
const t = execSync(`pdftotext -layout "${FILE}" -`, { encoding: "utf8", maxBuffer: 5e8 });
const txtPages = t.split("\f");
const planKw = /grondplan|niveau|verdieping|gelijkvloers|leefruimte|slaapkamer|appartement/gi;
const sectionKw = /gevel|snede|doorsnede|inplanting|situatie|^detail|elektr|riolering|stabiliteit/i;
const planPages = [];
txtPages.forEach((p, i) => { if (i < doc.countPages() && (p.match(planKw) || []).length >= 3 && !sectionKw.test(p.slice(0, 200))) planPages.push(i); });
process.stderr.write(`grondplan-pagina's: ${planPages.length} → [${planPages.join(",")}]\n`);

async function tiles(p) {
  const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(200/72,200/72), mupdf.ColorSpace.DeviceRGB,false,true);
  const full = Buffer.from(pix.asPNG()); const W=pix.getWidth(),H=pix.getHeight(); const G=3,OV=0.1,out=[];
  for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){const left=Math.max(0,Math.floor((gx/G-OV)*W)),top=Math.max(0,Math.floor((gy/G-OV)*H));const w=Math.min(W-left,Math.ceil((1/G+2*OV)*W)),h=Math.min(H-top,Math.ceil((1/G+2*OV)*H));let png=await sharp(full).extract({left,top,width:w,height:h}).png().toBuffer();if(Math.max(w,h)>1600)png=await sharp(png).resize(w>=h?{width:1568}:{height:1568}).png().toBuffer();if(png.length<=3.7e6)out.push(png.toString("base64"));}
  return out;
}
const SYS="You read EVERY printed area label (m²) off Belgian architect floor-plan tiles and categorise each. Tiles overlap → count each label once. Return ONLY JSON.";
const INSTR=`These overlapping tiles are ONE floor-plan sheet. Read EVERY printed area in m² (room labels like 'leefruimte 38.5', 'Slpk 12.8', 'badk 3.8', 'gang', 'berging', 'traphal', 'gaanderij', 'sas', terras, and any unit/commercial areas).
cat: cat1 = HEATED living/finished (all living rooms + common circulation: gang, hal, traphal, gaanderij, sas, lift lobby, commercial). cat2 = garage/parking/kelder/berging-ondergronds/techniek/fietsenberging. cat3 = terras/balkon/dakterras. other = non-floor.
Count each printed area ONCE (dedup across overlapping tiles by label+value).
Return JSON: {"floor_label":"...","areas":[{"label":"...","m2":<n>,"cat":"cat1|cat2|cat3|other"}],"legible":"high|med|low"}`;
async function vision(imgs){await sleep(800);const content=[{type:"text",text:INSTR},...imgs.map(b=>({type:"image",source:{type:"base64",media_type:"image/png",data:b}}))];for(let a=0;a<4;a++){const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":AKEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8000,system:SYS,messages:[{role:"user",content}]})});if(res.status===429||res.status>=500){await sleep(5000*(a+1));continue;}const j=await res.json();if(!res.ok)throw new Error(JSON.stringify(j).slice(0,150));const m=(j.content?.[0]?.text||"").match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null;}return null;}

let cat1=0,cat2=0,cat3=0;
for(const p of planPages){
  try{const r=await vision(await tiles(p));if(!r||!Array.isArray(r.areas)){process.stderr.write(`  p${p}: geen\n`);continue;}
    let c1=0;for(const a of r.areas){const v=+a.m2||0;if(v<=0||v>2000)continue;if(a.cat==='cat3')cat3+=v;else if(a.cat==='cat2')cat2+=v;else{cat1+=v;c1+=v;}}
    process.stderr.write(`  p${p} [${r.floor_label||'?'}] ${r.legible}: cat1 +${Math.round(c1)} (lopend ${Math.round(cat1)})\n`);
  }catch(e){process.stderr.write(`  p${p}: FOUT ${String(e.message).slice(0,80)}\n`);}
}
const d=((cat1/GT-1)*100).toFixed(0);
process.stderr.write(`\n25-547563 GT heated ${GT} → KAMER-SOM cat1=${Math.round(cat1)} (${d>=0?'+':''}${d}%) cat2=${Math.round(cat2)} cat3=${Math.round(cat3)}\n`);
