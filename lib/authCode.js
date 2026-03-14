function normalizeCode(code) {
  return String(code || "").toUpperCase().trim();
}

export async function createUser() {
  return { code: null, error: "Self-service code creation is disabled." };
}

/**
 * Verify a login code against the server.
 * Returns { valid, error, tier, email, auth_method }
 */
export async function verifyCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized || normalized.length !== 6) {
    return { valid: false, error: "Invalid code" };
  }

  try {
    const res = await fetch("/api/auth/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: normalized }),
    });
    const body = await res.json();
    if (!res.ok) return { valid: false, error: body?.error || "Invalid code" };
    return {
      valid: !!body?.valid,
      error: body?.error || null,
      tier: body?.tier || "free",
      email: body?.email || null,
      auth_method: body?.auth_method || "code",
    };
  } catch {
    return { valid: false, error: "Verification request failed" };
  }
}
