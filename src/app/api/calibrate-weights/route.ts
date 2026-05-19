import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { calibrateWeights } from "@/lib/qqp/weight-calibration";

export const maxDuration = 300;

export async function POST() {
  if (!SKIP_AUTH) {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await calibrateWeights();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Calibration failed";
    console.error("[calibrate-weights]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
