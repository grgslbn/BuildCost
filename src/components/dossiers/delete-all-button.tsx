"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";
import { deleteDossiers } from "@/app/actions/delete-dossier";

export function DeleteAllButton({ dossierIds }: { dossierIds: string[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  if (dossierIds.length === 0) return null;

  async function handleDeleteAll() {
    if (
      !window.confirm(
        `Delete all ${dossierIds.length} dossier${dossierIds.length !== 1 ? "s" : ""}? This cannot be undone.`
      )
    )
      return;

    setDeleting(true);
    await deleteDossiers(dossierIds);
    setDeleting(false);
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDeleteAll}
      disabled={deleting}
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      {deleting ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
      )}
      Delete all ({dossierIds.length})
    </Button>
  );
}
