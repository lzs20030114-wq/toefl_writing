const HEALTH_TIMEOUT_MS = 8000;

function hasValue(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function buildHeaders(anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const urlConfigured = hasValue(url);
  const keyConfigured = hasValue(anonKey);
  const configured = urlConfigured && keyConfigured;

  if (!configured) {
    return Response.json(
      {
        ok: false,
        configured: false,
        urlConfigured,
        keyConfigured,
        reachable: false,
        error: "Supabase env vars are missing.",
      },
      { status: 503 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const healthUrl = `${url.replace(/\/+$/, "")}/auth/v1/health`;
    const res = await fetch(healthUrl, {
      method: "GET",
      headers: buildHeaders(anonKey),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();

    return Response.json(
      {
        ok: res.ok,
        configured: true,
        urlConfigured: true,
        keyConfigured: true,
        reachable: res.ok,
        status: res.status,
        endpoint: "/auth/v1/health",
        responseSnippet: text.slice(0, 160),
      },
      { status: res.ok ? 200 : 502 }
    );
  } catch (e) {
    const message = e?.name === "AbortError" ? "Supabase health check timed out." : String(e?.message || "Unknown error");
    return Response.json(
      {
        ok: false,
        configured: true,
        urlConfigured: true,
        keyConfigured: true,
        reachable: false,
        error: message,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

