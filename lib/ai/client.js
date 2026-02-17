export async function callAI(
  system,
  message,
  maxTokens,
  timeoutMs = 30000,
  temperature = 0.3
) {
  let timeoutId;
  try {
    const requestPromise = (async () => {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system,
          message,
          maxTokens: maxTokens || 2000,
          temperature,
        }),
      });
      if (!r.ok) throw new Error("API error " + r.status);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d.content;
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("API timeout")), timeoutMs);
    });

    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function mapScoringError(err) {
  const raw = String(err?.message || err || "");
  const m = raw.toLowerCase();
  if (m.includes("api timeout")) return "Request timed out. Please check your network and retry.";
  if (m.includes("api error 401") || m.includes("api error 403")) return "Authentication failed (401/403).";
  if (m.includes("api error 429")) return "AI service 429";
  if (m.includes("unexpected token") || m.includes("json")) return "Invalid response format.";
  if (m.includes("api error")) return "Service is temporarily unavailable.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Network connection error.";
  return "Scoring failed.";
}
