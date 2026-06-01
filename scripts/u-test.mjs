/**
 * u-test.mjs — is the U-shape (small AND large apartments → high €/m²) REAL
 * signal or small-sample noise? Tests:
 *  (1) per-bin mean ± standard error (are extremes distinguishable from middle?)
 *  (2) bootstrap of the quadratic size² coefficient (is c reliably > 0?)
 *  (3) extremes (small<80, large>250) vs middle (110-250): difference ± SE
 * Run on a broader apartment-line set for statistical power.
 */
import { readFileSync } from "node:fs";

// broader apartment living lines
const apt = [];
for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m; const d = desc.toLowerCase();
  if (!/appartement/.test(d)) continue;
  if (/meerprijs|kelder|garage|berging|entree|tussenvloer|gemene|parking|technieken|zolder|inrichting|magazijn|kantoor|handel/.test(d)) continue;
  const size = +opp, price = +e;
  if (size < 25 || size > 500 || price < 1400 || price > 3800) continue; // plausible single apartments
  apt.push({ ref, size, price });
}
console.log(`Appartement-regels (breed): n=${apt.length}\n`);

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

console.log("=== (1) €/m² per grootteklasse, met standaardfout (SE = SD/√n) ===");
const bins = [[25,60],[60,80],[80,110],[110,150],[150,220],[220,300],[300,500]];
const binStats = [];
for (const [lo, hi] of bins) {
  const a = apt.filter(x => x.size >= lo && x.size < hi).map(x => x.price);
  if (a.length < 3) { console.log(`  ${lo}-${hi}: n=${a.length} (te weinig)`); continue; }
  const m = mean(a), se = sdv(a) / Math.sqrt(a.length);
  binStats.push({ lo, hi, m, se, n: a.length });
  console.log(`  ${String(lo).padStart(3)}-${String(hi).padStart(3)} m²: n=${String(a.length).padStart(3)}  €${Math.round(m)} ± ${Math.round(se)}  (95%: €${Math.round(m-2*se)}–${Math.round(m+2*se)})`);
}

// (3) extremes vs middle
const small = apt.filter(x => x.size < 80).map(x => x.price);
const mid   = apt.filter(x => x.size >= 110 && x.size < 220).map(x => x.price);
const large = apt.filter(x => x.size >= 250).map(x => x.price);
const cmp = (A, B, la, lb) => { const seA = sdv(A)/Math.sqrt(A.length), seB = sdv(B)/Math.sqrt(B.length); const diff = mean(A)-mean(B); const seD = Math.sqrt(seA*seA+seB*seB); console.log(`  ${la} (€${Math.round(mean(A))}, n=${A.length}) vs ${lb} (€${Math.round(mean(B))}, n=${B.length}): Δ=€${Math.round(diff)} ± ${Math.round(seD)}  → ${Math.abs(diff)>2*seD?"SIGNIFICANT":"niet significant"}`); };
console.log("\n=== (3) Uiteinden vs midden ===");
cmp(small, mid, "KLEIN<80 ", "MIDDEN 110-220");
cmp(large, mid, "GROOT>250", "MIDDEN 110-220");

// (2) bootstrap quadratic c
function fitQuad(pts){let S0=pts.length,S1=0,S2=0,S3=0,S4=0,T0=0,T1=0,T2=0;for(const p of pts){const x=p.size,y=p.price;S1+=x;S2+=x*x;S3+=x**3;S4+=x**4;T0+=y;T1+=x*y;T2+=x*x*y;}const A=[[S0,S1,S2],[S1,S2,S3],[S2,S3,S4]],B=[T0,T1,T2];for(let c=0;c<3;c++){let p=c;for(let r=c+1;r<3;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];for(let r=0;r<3;r++)if(r!==c){const f=A[r][c]/A[c][c];for(let k=0;k<3;k++)A[r][k]-=f*A[c][k];B[r]-=f*B[c];}}return {a:B[0]/A[0][0],b:B[1]/A[1][1],c:B[2]/A[2][2]};}
// seeded RNG (Math.random unavailable-safe via simple LCG)
let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const N=2000, cs=[], verts=[];
for(let b=0;b<N;b++){const s=[];for(let i=0;i<apt.length;i++)s.push(apt[(rnd()*apt.length)|0]);const f=fitQuad(s);cs.push(f.c);if(f.c>0)verts.push(-f.b/(2*f.c));}
cs.sort((a,b)=>a-b);
const pct=(p)=>cs[Math.floor(p*cs.length)];
const posFrac=cs.filter(x=>x>0).length/cs.length;
console.log(`\n=== (2) Bootstrap kwadratische term c (n=${N}) ===`);
console.log(`  c mediaan=${pct(0.5).toExponential(2)}  | 5%-95%: ${pct(0.05).toExponential(2)} .. ${pct(0.95).toExponential(2)}`);
console.log(`  P(c>0) = ${(posFrac*100).toFixed(0)}%  → ${posFrac>0.95?"U-VORM ROBUUST (c betrouwbaar >0)":posFrac>0.8?"zwakke aanwijzing voor U":"GEEN robuuste U (c niet betrouwbaar >0)"}`);
if(verts.length){verts.sort((a,b)=>a-b);console.log(`  vertex (minimum) mediaan ≈ ${Math.round(verts[Math.floor(verts.length/2)])} m²`);}
