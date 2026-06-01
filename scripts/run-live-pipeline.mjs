import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {}; for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g,""); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const PUBLIC_TENANT = "00000000-0000-0000-0000-000000000002";
const FILE = process.argv[2] || "C:/Users/tieme/Desktop/testing 1_6/23-4999740plannen.pdf";
const POSTCODE = process.argv[3] || "1030";
const FNAME = FILE.split(/[\\/]/).pop();
const SITE = "https://planbased.xyz";
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const id = randomUUID();
const path = `${PUBLIC_TENANT}/${id}/${FNAME}`;
console.log("1) upload naar storage:", path);
const buf = readFileSync(FILE);
let up = await sb.storage.from("plans").upload(path, buf, { contentType: "application/pdf", upsert: true });
if (up.error) { console.error("upload fout:", up.error.message); process.exit(1); }
console.log("   ✓ geüpload");

console.log("2) estimation-rij aanmaken (postcode "+POSTCODE+")");
const ins = await sb.from("estimations").insert({ tenant_id: PUBLIC_TENANT, created_by: null, plan_storage_path: path, plan_file_name: FNAME, postcode: POSTCODE, postcode_provided_by: "user", status: "uploading", source: "public" }).select("id").single();
if (ins.error) { console.error("insert fout:", ins.error.message); process.exit(1); }
const estId = ins.data.id; console.log("   ✓ estimationId:", estId);

console.log("3) live pipeline triggeren op planbased.xyz (inline, kan ~2-4 min duren)…");
const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), 295000);
fetch(`${SITE}/api/estimate-process`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ estimationId: estId, dpi: 100, maxPages: 10 }), signal: ctrl.signal }).then(r=>r.text()).then(t=>console.log("   estimate-process resp:", t.slice(0,200))).catch(e=>console.log("   estimate-process fetch:", String(e.message).slice(0,80))).finally(()=>clearTimeout(to));

console.log("4) pollen…");
for (let i=0;i<70;i++){
  await sleep(5000);
  const { data } = await sb.from("estimations").select("status,error_message,finishing_coefficient,total_livable_sqm,total_gross_sqm,sub_areas,estimated_total_cost,sqm_confidence,overall_confidence,building_type,base_price_per_sqm,abex_factor").eq("id", estId).single();
  if (!data) { console.log(`   [${i}] geen rij`); continue; }
  process.stdout.write(`   [${(i*5)}s] status=${data.status}\n`);
  if (data.status === "complete" || data.status === "error") {
    console.log("\n══ RESULTAAT ══");
    console.log(JSON.stringify({ status:data.status, error:data.error_message, building_type:data.building_type, F:data.finishing_coefficient, cat_prijs:data.base_price_per_sqm, abex:data.abex_factor, livable_sqm:data.total_livable_sqm, gross_sqm:data.total_gross_sqm, sqm_confidence:data.sqm_confidence, overall_confidence:data.overall_confidence, total_cost:data.estimated_total_cost }, null, 1));
    console.log("sub_areas:", JSON.stringify(data.sub_areas));
    break;
  }
}
