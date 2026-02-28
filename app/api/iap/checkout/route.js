import { IapError, toIapError } from "../../../../lib/iap/errors";
import { createCheckoutSession } from "../../../../lib/iap/service";

function jsonError(error) {
  const e = error instanceof IapError ? error : toIapError(error);
  return Response.json(
    {
      ok: false,
      error: e.code,
      message: e.message,
      details: e.details || null,
    },
    { status: e.status || 500 }
  );
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const checkout = await createCheckoutSession(body);
    return Response.json({ ok: true, checkout });
  } catch (e) {
    return jsonError(e);
  }
}

