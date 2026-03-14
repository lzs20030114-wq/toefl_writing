const FREE_DAILY_LIMIT = 3;

/**
 * Check if user can practice. Returns { allowed, remaining, limit }.
 * Legacy and pro users always get unlimited.
 */
export async function checkCanPractice(userCode, tier) {
  if (tier === "pro" || tier === "legacy") {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  try {
    const res = await fetch(`/api/usage?code=${encodeURIComponent(userCode)}`);
    const body = await res.json();
    if (!res.ok) return { allowed: true, remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT };
    return {
      allowed: body.remaining > 0,
      remaining: body.remaining,
      limit: body.limit,
    };
  } catch {
    // On error, allow practice (fail-open)
    return { allowed: true, remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT };
  }
}

/**
 * Consume one practice usage. Called after successful AI scoring.
 * Returns { remaining, error }.
 */
export async function consumeUsage(userCode, tier) {
  if (tier === "pro" || tier === "legacy") return { remaining: Infinity, error: null };

  try {
    const res = await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: userCode }),
    });
    const body = await res.json();
    if (!res.ok) return { remaining: 0, error: body?.error || "Usage update failed" };
    return { remaining: body.remaining, error: null };
  } catch {
    return { remaining: 0, error: "Usage request failed" };
  }
}

export { FREE_DAILY_LIMIT };
