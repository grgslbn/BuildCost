import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export type RateLimitResult =
  | { ok: true; remaining: number; ip: string }
  | { ok: false; retryAfterSeconds: number; ip: string };

export async function checkPublicEstimationLimit(
  req: NextRequest
): Promise<RateLimitResult> {
  const ip = getClientIp(req);
  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const cutoff = new Date(now - WINDOW_MS).toISOString();

  await admin
    .from("public_estimation_quota")
    .delete()
    .lt("window_at", cutoff);

  const { data: rows } = await admin
    .from("public_estimation_quota")
    .select("window_at, count")
    .eq("ip_address", ip)
    .gte("window_at", cutoff);

  const used = (rows ?? []).reduce((s, r) => s + Number(r.count), 0);

  if (used >= MAX_PER_WINDOW) {
    const oldest = (rows ?? [])
      .map((r) => new Date(r.window_at as string).getTime())
      .sort((a, b) => a - b)[0] ?? now;
    const retryAfter = Math.max(60, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { ok: false, retryAfterSeconds: retryAfter, ip };
  }

  await admin.from("public_estimation_quota").insert({
    ip_address: ip,
    window_at: new Date(now).toISOString(),
    count: 1,
  });

  return { ok: true, remaining: MAX_PER_WINDOW - used - 1, ip };
}
