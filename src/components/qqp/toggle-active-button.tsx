"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ToggleActiveButton({
  qqpId,
  isActive,
}: {
  qqpId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [optimistic, setOptimistic] = useState(isActive);

  async function handleToggle() {
    setLoading(true);
    const next = !optimistic;
    setOptimistic(next);
    try {
      await fetch("/api/manage-qqp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_active", qqpId, isActive: next }),
      });
      router.refresh();
    } catch {
      setOptimistic(!next);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handleToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
        optimistic ? "bg-primary" : "bg-input"
      }`}
      title={optimistic ? "Active — click to deactivate" : "Inactive — click to activate"}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transition-transform ${
          optimistic ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
