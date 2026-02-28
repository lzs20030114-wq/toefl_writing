export class IapError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "IapError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toIapError(err) {
  if (err instanceof IapError) return err;
  return new IapError("IAP_UNEXPECTED_ERROR", err?.message || "Unexpected IAP error", 500);
}

