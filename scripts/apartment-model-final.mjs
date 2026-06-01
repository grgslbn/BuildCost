/**
 * apartment-model-final.mjs — decisive: which plan-readable model best predicts
 * apartment €/m², and what is the irreducible residual (the finish ceiling)?
 * Per BUILDING (expert uses one rate per building). 5-fold CV MAE.
 * Features tested: avg unit size, size², #units, cat3_frac (terraces).
 */
import { readFileSync } from "node:fs";

// per-dossier category areas (for cat3_frac)
const tgt = {};
for (const r of readFileSync("scripts/expert-f-targets.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
  const [ref, c1, c2, c3] = r.split(","); const tot = +c1 + +c2 + +c3;
  tgt[ref] = { cat3_frac: tot ? +c3 / tot : 0 };
}

// apartment living lines -> per building
const byRef = {};
for (const r of readFileSync("scripts/harvest-prices.csv", "utf8").split("\n").slice(1).filter(Boolean)) {
  const m = r.match(/^([^,]+),([^,]+),"(.*)",([^,]+),([^,]+),([^,]+)$/); if (!m) continue;
  const [, ref, cat, desc, opp, , e] = m; const d = desc.toLowerCase();
  if (cat !== "cat1" || !/appartement/.test(d)) continue;
  if (/meerprijs|kelder|garage|berging|entree|tussenvloer|gemene|parking|technieken|zolder|inrichting/.test(d)) continue;
  const size = +opp, price = +e; if (size < 25 || size > 500 || price < 1200 || price > 4000) continue;
  (byRef[ref] ??= { sizes: [], prices: [] }); byRef[ref].sizes.push(size); byRef[ref].prices.push(price);
}
const B = Object.entries(byRef).map(([ref, v]) => {
  const med = [...v.prices].sort((a, b) => a - b)[Math.floor(v.prices.length / 2)];
  const avg = v.sizes.reduce((a, b) => a + b, 0) / v.sizes.length;
  return { ref, eur: med, avgSize: avg, nUnits: v.sizes.length, cat3: tgt[ref]?.cat3_frac ?? 0 };
});
console.log(`Appartementsgebouwen: ${B.length}\n`);

// ---- linear algebra (ridge w/ unpenalized intercept via centering) ----
function solve(A, b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];if(Math.abs(M[c][c])<1e-12)M[c][c]=1e-12;for(let r=0;r<n;r++)if(r!==c){const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}return M.map((r,i)=>r[n]/r[i]);}
function fit(X,y,lam){const n=X.length,k=X[0].length;const xb=Array(k).fill(0);let yb=0;for(let i=0;i<n;i++){yb+=y[i]/n;for(let j=0;j<k;j++)xb[j]+=X[i][j]/n;}const A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);for(let i=0;i<n;i++)for(let a=0;a<k;a++){const xa=X[i][a]-xb[a];b[a]+=xa*(y[i]-yb);for(let c=0;c<k;c++)A[a][c]+=xa*(X[i][c]-xb[c]);}for(let a=0;a<k;a++)A[a][a]+=lam;const w=solve(A,b);const b0=yb-xb.reduce((s,v,j)=>s+v*w[j],0);return{w,b0};}
const predict=(x,m)=>m.b0+x.reduce((s,v,j)=>s+v*m.w[j],0);
function cv(featFn, lam=1, folds=5){let e=0,c=0;for(let f=0;f<folds;f++){const Xtr=[],ytr=[],Xte=[],yte=[];B.forEach((d,i)=>{const row=featFn(d);(i%folds===f?Xte:Xtr).push(row);(i%folds===f?yte:ytr).push(d.eur);});if(Xtr.length<5)continue;const m=fit(Xtr,ytr,lam);Xte.forEach((row,i)=>{e+=Math.abs(predict(row,m)-yte[i]);c++;});}return e/c;}
const y=B.map(d=>d.eur);
const meanMAE=()=>{const mn=y.reduce((a,b)=>a+b)/y.length;return y.reduce((s,v)=>s+Math.abs(v-mn),0)/y.length;};
const sd=(()=>{const mn=y.reduce((a,b)=>a+b)/y.length;return Math.sqrt(y.reduce((s,v)=>s+(v-mn)**2,0)/y.length);})();

console.log(`Totale spreiding €/m²: SD = €${Math.round(sd)}  (mediaan €${[...y].sort((a,b)=>a-b)[Math.floor(y.length/2)]})\n`);
console.log("Model                                CV MAE €/m²");
console.log(`  constant (gemiddelde)              €${Math.round(meanMAE())}`);
console.log(`  size lineair                       €${Math.round(cv(d=>[d.avgSize]))}`);
console.log(`  size + size² (U-vorm)              €${Math.round(cv(d=>[d.avgSize,d.avgSize**2]))}`);
console.log(`  size + size² + #units              €${Math.round(cv(d=>[d.avgSize,d.avgSize**2,d.nUnits]))}`);
console.log(`  size + size² + cat3_frac           €${Math.round(cv(d=>[d.avgSize,d.avgSize**2,d.cat3]))}`);
console.log(`  size + size² + #units + cat3_frac  €${Math.round(cv(d=>[d.avgSize,d.avgSize**2,d.nUnits,d.cat3]))}`);

// best model coefficients + R²
const bestFeat = d=>[d.avgSize,d.avgSize**2,d.cat3];
const m = fit(B.map(bestFeat), y, 1);
const resid = B.map(d=>d.eur-predict(bestFeat(d),m));
const rSD = Math.sqrt(resid.reduce((s,v)=>s+v*v,0)/resid.length);
console.log(`\nBeste model (size+size²+cat3):  residu SD = €${Math.round(rSD)}  →  R² = ${(1-(rSD/sd)**2).toFixed(2)}`);
console.log(`  d.w.z. ~${Math.round((1-(rSD/sd)**2)*100)}% van de €/m²-variatie verklaard; de rest (€${Math.round(rSD)}) = afwerking + regio + ruis (onleesbaar van plan).`);
