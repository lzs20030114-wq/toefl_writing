import { saveAuth } from "./AuthContext";

const FREE_DAILY_LIMIT = 3;

/**
 * Check if user can practice. Returns { allowed, remaining, limit, tierExpired }.
 * Always goes through the server so expired pro is caught.
 */
export async function checkCanPractice(userCode, tier) {
  // Legacy users get pro-level access without server validation
  if (tier === "legacy") {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  try {
    const res = await fetch(`/api/usage?code=${encodeURIComponent(userCode)}`);
    const body = await res.json();
    if (!res.ok) return { allowed: true, remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT };

    // Server returns remaining=-1 for valid pro, or real count if expired/free
    const isPro = body.remaining === -1;

    // Detect tier expiry: client thinks pro but server says otherwise
    if (tier === "pro" && !isPro) {
      saveAuth(userCode, { tier: "free" });
      return {
        allowed: body.remaining > 0,
        remaining: body.remaining,
        limit: body.limit,
        tierExpired: true,
      };
    }

    return {
      allowed: isPro || body.remaining > 0,
      remaining: body.remaining,
      limit: body.limit,
    };
  } catch {
    // Fail-open
    if (tier === "pro" || tier === "legacy") {
      return { allowed: true, remaining: -1, limit: -1 };
    }
    return { allowed: true, remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT };
  }
}

/**
 * Consume practice usage. Called after successful AI scoring.
 * @param {string} userCode
 * @param {number} [count=1] — number of usages to consume (e.g. 3 for mock exam)
 * Returns { remaining, error }.
 */
export async function consumeUsage(userCode, count = 1) {
  try {
    const res = await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: userCode, count }),
    });
    const body = await res.json();
    if (!res.ok) return { remaining: 0, error: body?.error || "Usage update failed" };
    return { remaining: body.remaining, error: null };
  } catch {
    return { remaining: 0, error: "Usage request failed" };
  }
}

export { FREE_DAILY_LIMIT };
