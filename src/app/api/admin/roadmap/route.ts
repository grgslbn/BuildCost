import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { SKIP_AUTH } from "@/lib/dev-auth";

// GET /api/admin/roadmap — list all roadmap items
export async function GET() {
  if (!SKIP_AUTH) {
    const session = await getSessionWithRole();
    if (!session?.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("roadmap_items")
    .select("*")
    .order("priority", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

// POST /api/admin/roadmap — create a new item
export async function POST(req: NextRequest) {
  if (!SKIP_AUTH) {
    const session = await getSessionWithRole();
    if (!session?.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await req.json();
  const { title, description, status, assigned_to, category } = body as {
    title?: string;
    description?: string;
    status?: string;
    assigned_to?: string | null;
    category?: string;
  };

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Get max priority for the target status to append at bottom
  const targetStatus = status || "todo";
  const { data: maxRow } = await admin
    .from("roadmap_items")
    .select("priority")
    .eq("status", targetStatus)
    .order("priority", { ascending: false })
    .limit(1)
    .single();

  const nextPriority = (maxRow?.priority ?? -1) + 1;

  const { data, error } = await admin
    .from("roadmap_items")
    .insert({
      title: title.trim(),
      description: description?.trim() || "",
      status: targetStatus,
      priority: nextPriority,
      assigned_to: assigned_to || null,
      category: category || "general",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data }, { status: 201 });
}

// PATCH /api/admin/roadmap — update item(s): status, priority, fields
export async function PATCH(req: NextRequest) {
  if (!SKIP_AUTH) {
    const session = await getSessionWithRole();
    if (!session?.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await req.json();

  // Batch reorder: { reorder: [{ id, status, priority }] }
  if (body.reorder && Array.isArray(body.reorder)) {
    const admin = createSupabaseAdminClient();
    const updates = body.reorder as { id: string; status: string; priority: number }[];

    for (const u of updates) {
      await admin
        .from("roadmap_items")
        .update({ status: u.status, priority: u.priority })
        .eq("id", u.id);
    }

    return NextResponse.json({ ok: true });
  }

  // Single update: { id, ...fields }
  const { id, ...fields } = body as { id?: string; [key: string]: unknown };
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("roadmap_items")
    .update(fields)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

// DELETE /api/admin/roadmap — delete an item
export async function DELETE(req: NextRequest) {
  if (!SKIP_AUTH) {
    const session = await getSessionWithRole();
    if (!session?.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { id } = (await req.json()) as { id?: string };
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("roadmap_items").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
