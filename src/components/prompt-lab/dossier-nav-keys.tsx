"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keyboard navigation: Alt+Left/Right to move between dossiers */
export function DossierNavKeys({
  prevId,
  nextId,
}: {
  prevId: string | null;
  nextId: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only when Alt is held (avoid interfering with text input)
      if (!e.altKey) return;
      // Don't trigger when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowLeft" && prevId) {
        e.preventDefault();
        router.push(`/admin/prompt-lab/dossier/${prevId}`);
      }
      if (e.key === "ArrowRight" && nextId) {
        e.preventDefault();
        router.push(`/admin/prompt-lab/dossier/${nextId}`);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prevId, nextId, router]);

  return null;
}
