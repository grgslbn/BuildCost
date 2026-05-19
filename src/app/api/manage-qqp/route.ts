import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";

export async function POST(req: NextRequest) {
  if (!SKIP_AUTH) {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    action: "accept" | "reject" | "toggle_active";
    proposedName?: string;
    qqpId?: string;
    isActive?: boolean;
  };

  const admin = createSupabaseAdminClient();

  if (body.action === "accept" && body.proposedName) {
    // Manually accept a proposed QQP — if it doesn't exist yet, create it
    const { data: logs } = await admin
      .from("qqp_discovery_log")
      .select("proposed_description, proposed_data_type, dossier_id")
      .eq("proposed_name", body.proposedName)
      .eq("status", "proposed");

    if (!logs || logs.length === 0) {
      return NextResponse.json({ error: "No proposed logs found" }, { status: 404 });
    }

    const name = body.proposedName;
    const { data: existing } = await admin
      .from("qqp_definitions")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (!existing) {
      const descriptions = logs.map((l) => l.proposed_description).filter(Boolean) as string[];
      const dataTypes = logs.map((l) => l.proposed_data_type).filter(Boolean) as string[];
      const description = mostCommon(descriptions) ?? name.replace(/_/g, " ");
      const dataType = mostCommon(dataTypes) ?? "numeric";

      await admin.from("qqp_definitions").insert({
        name,
        display_name: toTitleCase(name),
        description,
        data_type: dataType,
        discovery_source: "ai_discovered",
        discovery_count: new Set(logs.map((l) => l.dossier_id)).size,
        is_active: true,
        weight: 0,
        weight_confidence: 0,
      });
    }

    await admin
      .from("qqp_discovery_log")
      .update({ status: "accepted" })
      .eq("proposed_name", body.proposedName)
      .eq("status", "proposed");

    return NextResponse.json({ success: true });
  }

  if (body.action === "reject" && body.proposedName) {
    await admin
      .from("qqp_discovery_log")
      .update({ status: "rejected" })
      .eq("proposed_name", body.proposedName)
      .eq("status", "proposed");
    return NextResponse.json({ success: true });
  }

  if (body.action === "toggle_active" && body.qqpId !== undefined) {
    await admin
      .from("qqp_definitions")
      .update({
        is_active: body.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.qqpId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

function toTitleCase(snake: string): string {
  return snake.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function mostCommon<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const freq = new Map<T, number>();
  for (const item of arr) freq.set(item, (freq.get(item) ?? 0) + 1);
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
}
