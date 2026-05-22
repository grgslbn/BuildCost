import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { PUBLIC_TENANT_ID } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();
  const { filename } = (await req.json()) as { filename?: string };
  if (!filename) {
    return NextResponse.json({ error: "Missing filename" }, { status: 400 });
  }

  const id = randomUUID();
  const path = `${PUBLIC_TENANT_ID}/${id}/${filename}`;

  const { data, error } = await admin.storage
    .from("plans")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create signed URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "ok",
    id,
    path,
    token: data.token,
    signedUrl: data.signedUrl,
  });
}
