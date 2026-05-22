import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/public-rate-limit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();
  const body = (await req.json()) as {
    email?: string;
    company?: string;
    role?: string;
    estimationId?: string;
  };

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const { error } = await admin.from("leads").insert({
    email,
    company: body.company?.trim() || null,
    role: body.role?.trim() || null,
    estimation_id: body.estimationId ?? null,
    ip_address: getClientIp(req),
    user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to save lead" },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: "ok" });
}
