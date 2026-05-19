import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";
import {
  retroactiveExtractForQQP,
  reExtractAllDossiers,
} from "@/lib/qqp/retroactive-extraction";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!SKIP_AUTH) {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    mode: "qqp" | "all";
    qqpId?: string;
    batchSize?: number;
    offset?: number;
  };

  try {
    if (body.mode === "qqp" && body.qqpId) {
      const result = await retroactiveExtractForQQP(
        body.qqpId,
        body.batchSize ?? 20
      );
      return NextResponse.json({ success: true, ...result });
    }

    if (body.mode === "all") {
      const result = await reExtractAllDossiers(
        body.batchSize ?? 10,
        body.offset ?? 0
      );
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Extraction failed";
    console.error("[retroactive-extract]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
