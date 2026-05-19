import { createSupabaseAdminClient } from "@/lib/supabase/server";

function toTitleCase(snake: string): string {
  return snake
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function mostCommon<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const freq = new Map<T, number>();
  for (const item of arr) freq.set(item, (freq.get(item) ?? 0) + 1);
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

export type DiscoveryResult = {
  activated: string[];
  skipped: string[];
};

/**
 * Scans qqp_discovery_log for proposed QQPs that have been suggested
 * across >= qqp_discovery_threshold distinct dossiers. Auto-creates
 * new qqp_definitions entries and marks the logs as 'accepted'.
 */
export async function evaluateDiscoveries(): Promise<DiscoveryResult> {
  const admin = createSupabaseAdminClient();

  // Read threshold from settings (default 3)
  const { data: thresholdRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "qqp_discovery_threshold")
    .single();
  const threshold = (thresholdRow?.value as number) ?? 3;

  // Load all proposed discovery log entries
  const { data: logs, error } = await admin
    .from("qqp_discovery_log")
    .select("id, proposed_name, proposed_description, proposed_data_type, dossier_id")
    .eq("status", "proposed");

  if (error || !logs || logs.length === 0) return { activated: [], skipped: [] };

  // Group by proposed_name, counting distinct dossier_ids
  type LogGroup = {
    descriptions: string[];
    dataTypes: string[];
    dossierIds: Set<string>;
    logIds: string[];
  };
  const byName = new Map<string, LogGroup>();

  for (const log of logs) {
    if (!byName.has(log.proposed_name)) {
      byName.set(log.proposed_name, {
        descriptions: [],
        dataTypes: [],
        dossierIds: new Set(),
        logIds: [],
      });
    }
    const entry = byName.get(log.proposed_name)!;
    if (log.proposed_description) entry.descriptions.push(log.proposed_description);
    if (log.proposed_data_type) entry.dataTypes.push(log.proposed_data_type);
    entry.dossierIds.add(log.dossier_id);
    entry.logIds.push(log.id);
  }

  const activated: string[] = [];
  const skipped: string[] = [];

  for (const [name, group] of Array.from(byName.entries())) {
    const count = group.dossierIds.size;

    if (count < threshold) continue;

    // Check if already in qqp_definitions
    const { data: existing } = await admin
      .from("qqp_definitions")
      .select("id, discovery_count")
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      // Already exists — update discovery_count and accept logs
      await admin
        .from("qqp_definitions")
        .update({
          discovery_count: Math.max(existing.discovery_count ?? 0, count),
          updated_at: new Date().toISOString(),
        })
        .eq("name", name);
      skipped.push(name);
    } else {
      const description =
        mostCommon(group.descriptions) ?? toTitleCase(name);
      const dataType =
        (mostCommon(group.dataTypes) as string | null) ?? "numeric";

      await admin.from("qqp_definitions").insert({
        name,
        display_name: toTitleCase(name),
        description,
        data_type: dataType,
        discovery_source: "ai_discovered",
        discovery_count: count,
        is_active: true,
        weight: 0,
        weight_confidence: 0,
      });

      activated.push(name);
      console.log(`[discovery-engine] Activated new QQP: ${name} (proposed by ${count} dossiers)`);
    }

    // Mark all matching logs as accepted
    await admin
      .from("qqp_discovery_log")
      .update({ status: "accepted" })
      .in("id", group.logIds);
  }

  return { activated, skipped };
}
