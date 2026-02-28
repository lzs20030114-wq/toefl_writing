import { IapError, toIapError } from "../../../../lib/iap/errors";
import { handleWebhook } from "../../../../lib/iap/service";

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
    const rawBody = await request.text();
    const result = await handleWebhook({ headers: request.headers, rawBody });
    return Response.json(result, { status: 200 });
  } catch (e) {
    return jsonError(e);
  }
}

