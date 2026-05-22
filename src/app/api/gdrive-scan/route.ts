import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { getDriveClient, parseFolderInput } from "@/lib/gdrive/client";

export const maxDuration = 60;

export type GDriveFile = {
  id: string;
  name: string;
  size: number;
};

export async function POST(req: NextRequest) {
  if (!SKIP_AUTH) {
    const supabase = createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderUrl } = (await req.json()) as { folderUrl?: string };
  if (!folderUrl) return NextResponse.json({ error: "Missing folderUrl" }, { status: 400 });

  const folderId = parseFolderInput(folderUrl);
  if (!folderId) return NextResponse.json({ error: "Could not parse folder ID" }, { status: 400 });

  try {
    const drive = getDriveClient();
    const files: GDriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        q: `mimeType = 'application/pdf' and '${folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, size)",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const f of res.data.files ?? []) {
        if (f.id && f.name) {
          files.push({ id: f.id, name: f.name, size: Number(f.size ?? 0) });
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return NextResponse.json({ files, total: files.length, folderId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Google Drive error";
    console.error("[gdrive-scan]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
