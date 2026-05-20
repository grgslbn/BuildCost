const TIMEOUT_MS = 270_000;

export async function processOneDossier(dossierId: string): Promise<"success" | "failed"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/process-dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dossierId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok ? "success" : "failed";
  } catch {
    clearTimeout(timer);
    return "failed";
  }
}
