/**
 * connect-regress.mjs — recover Connect Value per-section €/m² (esp. WOON) via
 * regression: total_excl_btw ≈ handels_m²·P_h(finish) + woon_m²·P_w + niet_m²·P_n.
 * 196 files (mostly commercial) → enough to estimate the woon coefficient.
 */
import { readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const DIR = "C:/Users/tieme/Mijn Drive/M²Value/connect value/calc";
const files = readdirSync(DIR).filter((f) => /^calc\d+\.pdf$/i.test(f));
const numNL = (s) => parseFloat(s.replace(/\./g, "").replace(",", "."));

const recs = [];
for (const f of files) {
  let t = ""; try { t = execSync(`pdftotext -layout "${join(DIR, f)}" -`, { encoding: "utf8", maxBuffer: 1e7 }); } catch { continue; }
  const iH = t.search(/Ingerichte handels/i), iW = t.search(/Woonvertrekken/i), iN = t.search(/Niet ingerichte ruimtes/i), iL = t.search(/Liften/i);
  const seg = (a, b) => t.slice(a, b > a ? b : undefined);
  const bruto = (s) => { const m = s.match(/Bruto m\S*\s+(\d[\d.]*)/); return m ? parseInt(m[1].replace(/\./g, ""), 10) : 0; };
  const hSeg = iH >= 0 ? seg(iH, iW) : "";
  const handels = iH >= 0 ? bruto(hSeg) : 0;
  const woon = iW >= 0 ? bruto(seg(iW, iN)) : 0;
  const niet = iN >= 0 ? bruto(seg(iN, iL)) : 0;
  // building excl btw = first amount after "Overige onroerende inrichting"
  const after = t.slice(t.search(/Overige onroerende inrichting/i));
  const amt = after.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
  const total = amt ? numNL(amt[1]) : 0;
  const abexM = t.match(/ABEX-index\s+(\d+)/); const abex = abexM ? +abexM[1] : 1050;
  if (!total || (handels + woon + niet) < 20) continue;
  // handels finish dummies
  const hi300 = />300cm/.test(hSeg) ? 1 : 0;
  const vitrine = /vitrine[^?]*\?\s*Ja/i.test(hSeg) ? 1 : 0;
  const airco = /airconditioning\?\s*Ja/i.test(hSeg) ? 1 : 0;
  const steen = /natuursteen of hout\?\s*Ja/i.test(hSeg) ? 1 : 0;
  recs.push({ f, handels, woon, niet, total: total * 1050 / abex, hi300, vitrine, airco, steen });
}
console.log(`Bruikbare files: ${recs.length} (woon>0: ${recs.filter(r=>r.woon>0).length})`);

// ── OLS: total = b_h·handels + b_w·woon + b_n·niet + handels·(finish adj) ──
function solve(A,b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];if(Math.abs(M[c][c])<1e-9)M[c][c]=1e-9;for(let r=0;r<n;r++)if(r!==c){const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}return M.map((r,i)=>r[n]/r[i]);}
function ols(rows, featFn) {
  const X = rows.map(featFn), y = rows.map(r => r.total), k = X[0].length;
  const A = Array.from({length:k},()=>Array(k).fill(0)), b = Array(k).fill(0);
  for (let i=0;i<X.length;i++) for (let a=0;a<k;a++){ b[a]+=X[i][a]*y[i]; for(let c=0;c<k;c++) A[a][c]+=X[i][a]*X[i][c]; }
  const w = solve(A,b);
  const yhat = X.map(x=>x.reduce((s,v,j)=>s+v*w[j],0));
  const ssr = y.reduce((s,v,i)=>s+(v-yhat[i])**2,0), my=y.reduce((a,bb)=>a+bb)/y.length, sst=y.reduce((s,v)=>s+(v-my)**2,0);
  return { w, r2: 1-ssr/sst };
}
// model: handels base + finish interactions, woon, niet
const feat = r => [r.handels, r.handels*r.hi300, r.handels*r.steen, r.handels*r.airco, r.handels*r.vitrine, r.woon, r.niet];
const names = ["handels_basis €/m²","  +>300cm","  +natuursteen/hout","  +airco","  +vitrine","WOON €/m²","niet-ingericht €/m²"];
const m = ols(recs, feat);
console.log(`\nRegressie (R² = ${m.r2.toFixed(3)}):`);
names.forEach((n,i)=>console.log(`  ${n.padEnd(22)} ${Math.round(m.w[i])}`));

// bootstrap the woon coefficient (index 5)
let seed=987654321; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const ws=[]; for(let b=0;b<500;b++){const s=[];for(let i=0;i<recs.length;i++)s.push(recs[(rnd()*recs.length)|0]);try{ws.push(ols(s,feat).w[5]);}catch{}}
ws.sort((a,b)=>a-b);
console.log(`\nWOON €/m² bootstrap:  mediaan €${Math.round(ws[ws.length/2|0])}  | 5%-95%: €${Math.round(ws[ws.length*0.05|0])} – €${Math.round(ws[ws.length*0.95|0])}`);

// two-step: per-woon-file implied woon €/m²
console.log(`\nPer woon-file (totaal − handels·P_h − niet·P_n) / woon_m²:`);
const Ph = (r)=> m.w[0] + m.w[1]*r.hi300 + m.w[2]*r.steen + m.w[3]*r.airco + m.w[4]*r.vitrine;
for (const r of recs.filter(r=>r.woon>0)) {
  const woonVal = r.total - r.handels*Ph(r) - r.niet*m.w[6];
  console.log(`  ${r.f}: woon ${r.woon}m² → €${Math.round(woonVal/r.woon)}/m²  (handels ${r.handels}, niet ${r.niet})`);
}
