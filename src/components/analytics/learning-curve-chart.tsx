"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export type ModelVersionPoint = {
  version: number;
  mae?: number | null;
  r_squared?: number | null;
  training_dossier_count?: number | null;
  created_at: string;
};

export function LearningCurveChart({ data }: { data: ModelVersionPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-44 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          Chart appears after 2+ calibrations
        </p>
      </div>
    );
  }

  const hasMae = data.some((d) => d.mae != null);
  const hasR2 = data.some((d) => d.r_squared != null);

  const chartData = data.map((d) => ({
    label: `v${d.version}`,
    ...(hasMae && d.mae != null ? { MAE: +d.mae.toFixed(4) } : {}),
    ...(hasR2 && d.r_squared != null ? { "R²": +d.r_squared.toFixed(4) } : {}),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={44} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          formatter={(v, name) => [typeof v === "number" ? v.toFixed(4) : v, name]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {hasMae && (
          <Line
            type="monotone"
            dataKey="MAE"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        )}
        {hasR2 && (
          <Line
            type="monotone"
            dataKey="R²"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
