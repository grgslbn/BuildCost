/**
 * wait-trainset.mjs — poll until all trainset estimations are terminal.
 * Exits when no jobs are pending (or after a max wait). Run in background;
 * its completion re-invokes the agent to run refit-f.mjs.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const ids = readFileSync("scripts/trainset-runmap.csv", "utf8").split("\n").slice(1).filter(Boolean)
  .map((r) => r.split(",")[2]);
const idList = ids.map((i) => `"${i}"`).join(",");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX = 70; // ~70 * 45s ≈ 52 min
for (let i = 0; i < MAX; i++) {
  await sleep(45000);
  let rows = [];
  try {
    const res = await fetch(`${URL}/rest/v1/estimations?select=status&id=in.(${idList})`, { headers: H });
    rows = await res.json();
  } catch { continue; }
  const complete = rows.filter((r) => r.status === "complete").length;
  const error = rows.filter((r) => r.status === "error").length;
  const pending = rows.length - complete - error;
  console.log(`[${new Date().toISOString().slice(11, 19)}] complete=${complete} error=${error} pending=${pending}`);
  if (pending === 0 && rows.length >= ids.length) { console.log("KLAAR — alle jobs terminal."); break; }
}
console.log("Waiter gestopt.");
