"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AnalyticsControls({ hasPending }: { hasPending: boolean }) {
  const router = useRouter();

  // Auto-refresh every 30 s while processing jobs are in flight
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [hasPending, router]);

  return (
    <Button variant="outline" size="sm" onClick={() => router.refresh()} className="gap-1.5">
      <RefreshCw className="h-3.5 w-3.5" />
      Refresh
    </Button>
  );
}
