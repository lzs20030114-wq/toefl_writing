import { IapError, toIapError } from "../../../../lib/iap/errors";
import { getUserEntitlements } from "../../../../lib/iap/service";

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

function resolveUserCode(request, url) {
  const fromQuery = String(url.searchParams.get("userCode") || "").trim();
  if (fromQuery) return fromQuery;
  const fromHeader = String(request.headers.get("x-user-code") || "").trim();
  return fromHeader;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const userCode = resolveUserCode(request, url);
    const entitlements = await getUserEntitlements(userCode);
    return Response.json({ ok: true, entitlements });
  } catch (e) {
    return jsonError(e);
  }
}

