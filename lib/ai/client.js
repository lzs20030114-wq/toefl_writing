export async function callAI(system, message, maxTokens, timeoutMs = 25000) {
  let timeoutId;
  try {
    const requestPromise = (async () => {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system, message, maxTokens: maxTokens || 1200 }),
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
  if (m.includes("api timeout")) {
    return "请求超时，请检查网络后重试";
  }
  if (m.includes("api error 401") || m.includes("api error 403")) {
    return "鉴权失败 (401/403)";
  }
  if (m.includes("api error 429")) {
    return "AI service 429";
  }
  if (m.includes("unexpected token") || m.includes("json")) {
    return "返回格式异常";
  }
  if (m.includes("api error")) {
    return "服务暂时不可用";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "网络连接异常";
  }
  return "评分失败";
}
