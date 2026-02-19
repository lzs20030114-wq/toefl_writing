function normalizeCode(code) {
  return String(code || "").toUpperCase().trim();
}

export async function createUser() {
  return { code: null, error: "Self-service code creation is disabled." };
}

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
    return { valid: !!body?.valid, error: body?.error || null };
  } catch {
    return { valid: false, error: "Verification request failed" };
  }
}

