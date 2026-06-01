import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs"; import { resolve, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {}; for (const l of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g,""); }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

const cur = await sb.from("qqp_model_versions").select("*").eq("is_active",true).maybeSingle();
if (cur.error || !cur.data) { console.log("kon actief model niet lezen:", cur.error?.message); process.exit(1); }
const v = cur.data;
const SHIFT = 0.255; // live F-mediaan 1.295 → CED-mediaan 1.04
const newIntercept = +(v.intercept - SHIFT).toFixed(4);
console.log(`Huidig: v${v.version} intercept ${v.intercept} (id ${v.id})`);
console.log(`Nieuw: intercept ${newIntercept} (shift −${SHIFT})`);

// insert v102 (weights identiek, enkel intercept verlaagd)
const row = {
  version: (v.version||101) + 1,
  weights: v.weights,
  intercept: newIntercept,
  lambda: v.lambda,
  prompt_version_id: v.prompt_version_id,
  training_dossier_count: v.training_dossier_count,
  accuracy_metrics: v.accuracy_metrics,
  training_config: v.training_config,
  notes: `connect-v1 de-biased: intercept ${v.intercept}→${newIntercept} (−${SHIFT}) to center the F-median on the CED-median 1.04 (€2150), removing the systematic +0.255 / +19% overshoot. Weights unchanged from v${v.version}. Rollback: set v${v.version} is_active=true.`,
  is_active: true,
};
const ins = await sb.from("qqp_model_versions").insert(row).select("id,version,intercept").single();
if (ins.error) { console.log("insert v102 FOUT:", ins.error.message); process.exit(1); }
console.log("✓ v"+ins.data.version+" aangemaakt (id "+ins.data.id+", intercept "+ins.data.intercept+")");
const upd = await sb.from("qqp_model_versions").update({ is_active:false }).eq("id", v.id);
if (upd.error) { console.log("deactiveren v"+v.version+" FOUT:", upd.error.message); process.exit(1); }
console.log("✓ v"+v.version+" gedeactiveerd");
const chk = await sb.from("qqp_model_versions").select("version,intercept,is_active").eq("is_active",true).maybeSingle();
console.log("ACTIEF NU:", JSON.stringify(chk.data));
