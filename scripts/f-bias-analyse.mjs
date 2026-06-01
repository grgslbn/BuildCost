import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs"; import { resolve, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {}; for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g,""); }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const med = a => { const s=[...a].sort((x,y)=>x-y); return s.length?s[Math.floor(s.length/2)]:null; };

// 1) active F-model
const mv = await sb.from("qqp_model_versions").select("id,name,version,intercept,is_active").eq("is_active",true).maybeSingle();
console.log("ACTIEF F-MODEL:", JSON.stringify(mv.data), mv.error?("err:"+mv.error.message):"");

// 2) predicted_f vs expert_f pairs from evaluation_results
const er = await sb.from("evaluation_results").select("predicted_f,expert_f,cost_error_pct,cat1_error_pct").not("predicted_f","is",null).not("expert_f","is",null);
if (er.error){ console.log("evaluation_results err:", er.error.message); }
const rows = (er.data||[]).filter(r=>r.predicted_f>0 && r.expert_f>0);
const diffs = rows.map(r=>r.predicted_f - r.expert_f);
const preds = rows.map(r=>r.predicted_f), exps = rows.map(r=>r.expert_f);
console.log(`\nF-PAREN (n=${rows.length}):`);
console.log(`  predicted_f: mediaan ${med(preds)?.toFixed(3)}  min ${Math.min(...preds).toFixed(2)} max ${Math.max(...preds).toFixed(2)}`);
console.log(`  expert_f:    mediaan ${med(exps)?.toFixed(3)}  min ${Math.min(...exps).toFixed(2)} max ${Math.max(...exps).toFixed(2)}`);
console.log(`  BIAS (predicted − expert): mediaan ${med(diffs)?.toFixed(3)}  gem ${(diffs.reduce((a,b)=>a+b,0)/diffs.length).toFixed(3)}`);
const costErr = rows.map(r=>r.cost_error_pct).filter(x=>x!=null);
if (costErr.length) console.log(`  cost_error_pct: mediaan ${med(costErr)?.toFixed(1)}%`);
const bias = med(diffs);
if (mv.data && bias!=null) console.log(`\n→ ONTBIASTE intercept = ${mv.data.intercept} − ${bias.toFixed(3)} = ${(mv.data.intercept-bias).toFixed(4)}`);
