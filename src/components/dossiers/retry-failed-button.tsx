"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { retryFailedDossiers } from "@/app/actions/retry-failed-dossiers";

export function RetryFailedButton({ failedCount }: { failedCount: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  if (failedCount === 0) return null;

  async function handleRetry() {
    if (loading) return;
    setLoading(true);
    try {
      const { count } = await retryFailedDossiers();
      toast({ title: `${count} dossier${count !== 1 ? "s" : ""} reset to pending` });
      router.refresh();
    } catch {
      toast({ title: "Failed to reset dossiers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRetry} disabled={loading}>
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RotateCcw className="mr-2 h-4 w-4" />
      )}
      Retry Failed ({failedCount})
    </Button>
  );
}
