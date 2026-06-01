/**
 * apartment-size-shape.mjs — test the U-shape hypothesis:
 * do BOTH small AND very large apartments have high €/m²?
 * Region is stripped (postcode -> regional coeff) since region is already in
 * the cost formula. Fits a quadratic price = a + b*size + c*size².
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim(); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const REG = [[1000,1210,1.0],[1300,1499,0.967],[1500,1999,0.987],[2000,2060,0.987],[2070,2999,0.967],[3000,3499,0.967],[3500,3999,0.953],[4000,4999,0.953],[5000,5999,0.940],[6000,6599,0.920],[6600,6999,0.940],[7000,7999,0.940],[8000,8299,0.973],[8300,8699,0.987],[8700,8999,0.967],[9000,9299,0.973],[9300,9999,0.953]];
const coeff = (pc) => { const n = parseInt(pc, 10); if (isNaN(n)) return 1.0; for (const [a, b, c] of REG) if (n >= a && n <= b) return c; return 1.0; };

// postcodes per plan_file_name
const pcByName = {};
let off = 0;
while (true) {
  const r = await (await fetch(`${URL}/rest/v1/reference_dossiers?select=plan_file_name,postcode&offset=${off}&limit=1000`, { headers: H })).json();
  if (!r.length) break;
  for (const d of r) if (d.plan_file_name) pcByName[d.plan_file_name] = d.postcode;
  off += 1000; if (r.length < 1000) break;
}
const known = Object.values(pcByName).filter(Boolean).length;
console.log(`Postcodes bekend: ${known}/${Object.keys(pcByName).length} dossiers`);

// apartment living lines
const apt = [];
for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m; const d = desc.toLowerCase();
  if (cat !== "cat1" || !/appartement/.test(d)) continue;
  if (/meerprijs|kelder|garage|berging|entree|tussenvloer|gemene|parking|technieken|zolder|inrichting/.test(d)) continue;
  const size = +opp, price = +e; if (size < 25 || size > 500 || price < 1200 || price > 4000) continue;
  const pc = pcByName[`${ref}_Plannen.pdf`];
  const c = pc ? coeff(pc) : 1.0;
  apt.push({ ref, size, raw: price, neutral: Math.round(price / c), hasPc: !!pc });
}
console.log(`Appartement-regels: ${apt.length} (met postcode: ${apt.filter(a=>a.hasPc).length})\n`);

console.log("=== €/m² per grootteklasse (regio-neutraal) ===");
const bins = [[25,50],[50,70],[70,90],[90,110],[110,140],[140,180],[180,250],[250,350],[350,500]];
for (const [lo,hi] of bins) {
  const a = apt.filter(x=>x.size>=lo&&x.size<hi);
  if (!a.length) continue;
  const m = Math.round(a.reduce((s,x)=>s+x.neutral,0)/a.length);
  const raw = Math.round(a.reduce((s,x)=>s+x.raw,0)/a.length);
  const sd = Math.round(Math.sqrt(a.reduce((s,x)=>s+(x.neutral-m)**2,0)/a.length));
  console.log(`  ${String(lo).padStart(3)}-${String(hi).padStart(3)} m²: n=${String(a.length).padStart(3)}  neutraal €${m}  (raw €${raw}, ±${sd})  ${"█".repeat(Math.round((m-1800)/40))}`);
}

// quadratic fit: price = a + b*size + c*size^2
function fitQuad(pts) {
  let S0=pts.length,S1=0,S2=0,S3=0,S4=0,T0=0,T1=0,T2=0;
  for (const p of pts){const x=p.size,y=p.neutral;S1+=x;S2+=x*x;S3+=x*x*x;S4+=x*x*x*x;T0+=y;T1+=x*y;T2+=x*x*y;}
  // solve 3x3 [S0 S1 S2; S1 S2 S3; S2 S3 S4] [a b c] = [T0 T1 T2]
  const A=[[S0,S1,S2],[S1,S2,S3],[S2,S3,S4]],B=[T0,T1,T2];
  for(let c=0;c<3;c++){let p=c;for(let r=c+1;r<3;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];for(let r=0;r<3;r++)if(r!==c){const f=A[r][c]/A[c][c];for(let k=0;k<3;k++)A[r][k]-=f*A[c][k];B[r]-=f*B[c];}}
  return [B[0]/A[0][0],B[1]/A[1][1],B[2]/A[2][2]];
}
const [a,b,c] = fitQuad(apt);
console.log(`\n=== Kwadratische fit (regio-neutraal):  €/m² = ${a.toFixed(0)} + (${b.toFixed(2)})·m² + (${c.toFixed(4)})·m²² ===`);
console.log(c > 0 ? `  c > 0 → U-VORM bevestigd (hoog aan beide uiteinden), minimum rond ${Math.round(-b/(2*c))} m²` : `  c <= 0 → geen U-vorm (eerder dalend/omgekeerd)`);
