import { IapError, toIapError } from "../../../../lib/iap/errors";
import { listProducts } from "../../../../lib/iap/service";

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

export async function GET() {
  try {
    const products = await listProducts();
    return Response.json({ ok: true, products });
  } catch (e) {
    return jsonError(e);
  }
}

