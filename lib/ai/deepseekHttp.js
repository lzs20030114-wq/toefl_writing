const http = require("http");
const https = require("https");
const tls = require("tls");
const { URL } = require("url");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function resolveProxyUrl() {
  const v = process.env.DEEPSEEK_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  return String(v || "").trim();
}

function parseHttpResponse(raw) {
  const splitIdx = raw.indexOf("\r\n\r\n");
  if (splitIdx < 0) throw new Error("invalid HTTP response from DeepSeek");
  const headerPart = raw.slice(0, splitIdx);
  const bodyPart = raw.slice(splitIdx + 4);
  const lines = headerPart.split("\r\n");
  const m = lines[0].match(/^HTTP\/\d\.\d\s+(\d{3})/i);
  const statusCode = m ? Number(m[1]) : 0;
  return { statusCode, body: bodyPart };
}

function decodeChunkedBody(body) {
  let cursor = 0;
  let out = "";
  while (cursor < body.length) {
    const rn = body.indexOf("\r\n", cursor);
    if (rn < 0) break;
    const sizeHex = body.slice(cursor, rn).trim();
    const size = Number.parseInt(sizeHex, 16);
    if (!Number.isFinite(size)) break;
    cursor = rn + 2;
    if (size === 0) break;
    out += body.slice(cursor, cursor + size);
    cursor += size + 2;
  }
  return out || body;
}

function postDirect(apiKey, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      DEEPSEEK_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (d) => {
          body += d.toString("utf8");
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`DeepSeek ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          resolve(body);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("DeepSeek request timeout")));
    req.on("error", reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

function postViaHttpProxy(apiKey, payload, timeoutMs, proxyUrl) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const target = new URL(DEEPSEEK_URL);
    const connectHeaders = { Host: `${target.hostname}:443` };
    if (proxy.username || proxy.password) {
      const decodedUser = decodeURIComponent(proxy.username || "");
      const decodedPass = decodeURIComponent(proxy.password || "");
      const token = Buffer.from(`${decodedUser}:${decodedPass}`).toString("base64");
      connectHeaders["Proxy-Authorization"] = `Basic ${token}`;
    }

    const connectReq = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: "CONNECT",
      path: `${target.hostname}:443`,
      headers: connectHeaders,
      timeout: timeoutMs,
    });

    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: ${res.statusCode}`));
        return;
      }

      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname,
      });
      tlsSocket.setTimeout(timeoutMs);
      tlsSocket.on("timeout", () => tlsSocket.destroy(new Error("DeepSeek proxied request timeout")));
      tlsSocket.on("error", reject);
      tlsSocket.once("secureConnect", () => {
        const body = JSON.stringify(payload);
        const reqText =
          `POST ${target.pathname} HTTP/1.1\r\n` +
          `Host: ${target.hostname}\r\n` +
          "Content-Type: application/json\r\n" +
          `Authorization: Bearer ${apiKey}\r\n` +
          `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n` +
          "Connection: close\r\n\r\n" +
          body;
        tlsSocket.write(reqText);
      });

      let raw = "";
      tlsSocket.on("data", (chunk) => {
        raw += chunk.toString("utf8");
      });
      tlsSocket.on("end", () => {
        try {
          const parsed = parseHttpResponse(raw);
          const decodedBody = decodeChunkedBody(parsed.body);
          if (parsed.statusCode < 200 || parsed.statusCode >= 300) {
            reject(new Error(`DeepSeek ${parsed.statusCode}: ${decodedBody.slice(0, 300)}`));
            return;
          }
          resolve(decodedBody);
        } catch (e) {
          reject(e);
        }
      });
    });

    connectReq.on("timeout", () => connectReq.destroy(new Error("proxy CONNECT timeout")));
    connectReq.on("error", reject);
    connectReq.end();
  });
}

async function callDeepSeekViaCurl({
  apiKey,
  payload,
  timeoutMs = 60000,
  proxyUrl = resolveProxyUrl(),
}) {
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");
  if (!payload || typeof payload !== "object") throw new Error("DeepSeek payload must be an object");

  let rawBody = "";
  try {
    if (!proxyUrl) {
      rawBody = await postDirect(apiKey, payload, timeoutMs);
    } else if (/^https?:\/\//i.test(proxyUrl)) {
      rawBody = await postViaHttpProxy(apiKey, payload, timeoutMs, proxyUrl);
    } else if (/^socks5h?:\/\//i.test(proxyUrl)) {
      throw new Error(
        `SOCKS proxy is not supported by current Node transport: ${proxyUrl}. ` +
          "Please enable an HTTP proxy port (e.g. http://127.0.0.1:10809) and set DEEPSEEK_PROXY_URL.",
      );
    } else {
      throw new Error(`Unsupported proxy schema: ${proxyUrl}`);
    }
  } catch (e) {
    if (proxyUrl && /^https?:\/\//i.test(proxyUrl)) {
      const msg = String(e?.message || e);
      if (msg.includes("HPE_CR_EXPECTED") || msg.includes("Missing expected CR after response line")) {
        throw new Error(
          `Proxy endpoint is not a valid HTTP proxy: ${proxyUrl}. ` +
            "Please switch to your real HTTP proxy port (commonly http://127.0.0.1:10809).",
        );
      }
    }
    throw e;
  }

  const body = String(rawBody || "").trim();
  if (!body) throw new Error("DeepSeek response is empty");

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error(`DeepSeek returned non-JSON payload: ${body.slice(0, 200)}`);
  }

  if (data?.error) {
    const msg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    throw new Error(`DeepSeek API error: ${msg}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`DeepSeek response missing content: ${body.slice(0, 200)}`);
  }
  return content;
}

module.exports = {
  resolveProxyUrl,
  callDeepSeekViaCurl,
};
