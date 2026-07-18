export class CreditError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "CreditError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeUserCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new CreditError("CREDITS_INVALID_USER", "Valid user code is required", 400);
  }
  return code;
}

