// Use SKIP_AUTH (no NEXT_PUBLIC_ prefix) — never inlined at build time,
// always read from the real process.env at runtime on both Node.js and edge.
// Set SKIP_AUTH=true in Vercel env vars to bypass auth on staging.
export const SKIP_AUTH = process.env.SKIP_AUTH === "true";

export const DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Tenant used for unauthenticated estimations created from the public landing page.
export const PUBLIC_TENANT_ID = "00000000-0000-0000-0000-000000000002";
