"use client";

import { cn } from "@/lib/utils";

function scoreColor(score: number): string {
  if (score >= 90) return "bg-green-100 text-green-700 border-green-200";
  if (score >= 80) return "bg-lime-100 text-lime-700 border-lime-200";
  if (score >= 70) return "bg-amber-100 text-amber-700 border-amber-200";
  if (score >= 60) return "bg-orange-100 text-orange-700 border-orange-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Fair";
  if (score >= 60) return "Poor";
  return "Bad";
}

/** Compact badge showing an accuracy score (0-100) with color coding */
export function AccuracyBadge({
  score,
  size = "md",
}: {
  score: number;
  size?: "sm" | "md";
}) {
  const rounded = Math.round(score);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium tabular-nums",
        scoreColor(rounded),
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs",
      )}
    >
      {rounded}
      {size === "md" && <span className="font-normal opacity-70">· {scoreLabel(rounded)}</span>}
    </span>
  );
}

/** Compact horizontal bar for use in table cells */
export function AccuracyBar({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const rounded = Math.round(score);
  const barColorClass =
    rounded >= 90
      ? "bg-green-500"
      : rounded >= 80
        ? "bg-lime-500"
        : rounded >= 70
          ? "bg-amber-500"
          : rounded >= 60
            ? "bg-orange-500"
            : "bg-red-500";

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColorClass)}
          style={{ width: `${rounded}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-[24px] text-right">
        {rounded}
      </span>
    </div>
  );
}
