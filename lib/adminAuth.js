export function readAdminToken(request) {
  const h = request.headers;
  const fromHeader = h.get("x-admin-token");
  if (fromHeader) return String(fromHeader).trim();
  const auth = String(h.get("authorization") || "").trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return "";
}

export function isAdminAuthorized(request) {
  const expected = String(process.env.ADMIN_DASHBOARD_TOKEN || "").trim();
  if (!expected) return false;
  const actual = readAdminToken(request);
  return !!actual && actual === expected;
}

