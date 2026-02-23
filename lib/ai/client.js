export async function callAI(
  system,
  message,
  maxTokens,
  timeoutMs = 30000,
  temperature = 0.3
) {
  let timeoutId;
  const controller = new AbortController();

  const clientId = (() => {
    try {
      const key = "toefl-client-id";
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const generated =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, generated);
      return generated;
    } catch {
      return "";
    }
  })();
  try {
    const requestPromise = (async () => {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientId ? { "X-Client-Id": clientId } : {}),
        },
        signal: controller.signal,
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
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("API timeout"));
      }, timeoutMs);
    });

    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function mapScoringError(err) {
  const raw = String(err?.message || err || "");
  const m = raw.toLowerCase();
  if (m.includes("empty ai response")) return "评分失败，AI服务暂时不可用";
  if (m.includes("api timeout")) return "网络超时（30秒），请重试";
  if (m.includes("api error 401") || m.includes("api error 403")) return "认证失败（401/403）";
  if (m.includes("api error 429")) return "AI服务繁忙（429），请稍后重试";
  if (m.includes("unexpected token") || m.includes("json") || m.includes("parse")) return "AI返回格式异常，请重试";
  if (m.includes("api error")) return "评分服务暂时不可用";
  if (m.includes("failed to fetch") || m.includes("network")) return "网络连接异常，请检查后重试";
  return "评分失败，请重试";
}
