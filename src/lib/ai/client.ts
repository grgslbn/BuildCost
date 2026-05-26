import Anthropic from "@anthropic-ai/sdk";

// Create the client lazily so process.env is read at request time, not at
// module-evaluation time (where Next.js RSC context may not have env vars yet).
// Use || (not ??) so empty-string values also trigger the fallback.
function makeClient(): Anthropic {
  const apiKey =
    process.env.ANTHROPIC_API_KEY || process.env.BUILDCOST_ANTHROPIC_KEY;
  if (!apiKey) {
    throw new Error(
      "[client.ts] No Anthropic API key found. " +
        "Set ANTHROPIC_API_KEY or BUILDCOST_ANTHROPIC_KEY in .env.local."
    );
  }
  console.log("[client.ts] Creating Anthropic client, key prefix:", apiKey.substring(0, 15));
  return new Anthropic({ apiKey });
}

let _client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!_client) _client = makeClient();
  return _client;
}

// Proxy so all existing `anthropic.messages.stream(...)` calls keep working.
export const anthropic = new Proxy({} as Anthropic, {
  get(_t, prop: string | symbol) {
    const c = getClient();
    const v = (c as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});
