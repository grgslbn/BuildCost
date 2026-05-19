// Check both the NEXT_PUBLIC_ variant (baked into client bundles at build time)
// and the plain SKIP_AUTH variant (always read at runtime from process.env, safe for edge/server).
export const SKIP_AUTH =
  process.env.NEXT_PUBLIC_SKIP_AUTH === "true" ||
  process.env.SKIP_AUTH === "true";

export const DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001";
