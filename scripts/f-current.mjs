import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs"; import { resolve, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {}; for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g,""); }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const med = a => { const s=[...a].sort((x,y)=>x-y); return s.length?s[Math.floor(s.length/2)]:null; };
// active model — inspect columns
const mv = await sb.from("qqp_model_versions").select("*").eq("is_active",true).maybeSingle();
if (mv.error) console.log("model err:", mv.error.message);
else { const d=mv.data; console.log("ACTIEF MODEL kolommen:", Object.keys(d).join(", ")); console.log("  id:", d.id, "intercept:", d.intercept, "version:", d.version ?? d.model_key ?? "?"); }
// current-model F distribution from estimations (recent completes)
const es = await sb.from("estimations").select("finishing_coefficient,estimated_price_per_sqm,building_type,status,created_at").eq("status","complete").not("finishing_coefficient","is",null).order("created_at",{ascending:false}).limit(300);
const fs = (es.data||[]).map(r=>r.finishing_coefficient).filter(x=>x>0);
console.log(`\nHUIDIGE estimations F (n=${fs.length}): mediaan ${med(fs)?.toFixed(3)} min ${Math.min(...fs).toFixed(2)} max ${Math.max(...fs).toFixed(2)}`);
const apt = (es.data||[]).filter(r=>r.building_type==="apartment_building"&&r.finishing_coefficient>0).map(r=>r.finishing_coefficient);
if (apt.length) console.log(`  apartments (n=${apt.length}): mediaan F ${med(apt)?.toFixed(3)}`);
