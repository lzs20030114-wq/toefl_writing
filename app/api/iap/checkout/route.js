import { iapJsonError } from "../../../../lib/iap/errors";
import { createCheckoutSession } from "../../../../lib/iap/service";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const checkout = await createCheckoutSession(body);
    return Response.json({ ok: true, checkout });
  } catch (e) {
    return iapJsonError(e);
  }
}

