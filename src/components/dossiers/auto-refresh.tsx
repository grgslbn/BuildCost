"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const IN_PROGRESS = new Set(["pending", "extracting_sqm", "sqm_done", "extracting_qqp"]);

export function AutoRefresh({ statuses }: { statuses: string[] }) {
  const router = useRouter();
  const hasInProgress = statuses.some((s) => IN_PROGRESS.has(s));

  useEffect(() => {
    if (!hasInProgress) return;
    const interval = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(interval);
  }, [hasInProgress, router]);

  return null;
}
