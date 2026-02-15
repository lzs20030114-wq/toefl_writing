const http = require("http");
const https = require("https");
const tls = require("tls");
const { URL } = require("url");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function resolveProxyUrl() {
  const v = process.env.DEEPSEEK_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  return String(v || "").trim();
}

function parseJsonLenient(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("empty payload");
  try {
    return JSON.parse(text);
  } catch (_) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const slice = text.slice(first, last + 1);
      return JSON.parse(slice);
    }
    throw _;
  }
}

function parseHttpResponse(rawBuffer) {
  const raw = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || "");
  const text = raw.toString("latin1");
  let splitIdx = text.indexOf("\r\n\r\n");
  let sepLen = 4;
  if (splitIdx < 0) {
    splitIdx = text.indexOf("\n\n");
    sepLen = 2;
  }
  if (splitIdx < 0) throw new Error("invalid HTTP response from DeepSeek");
  const headerPart = text.slice(0, splitIdx);
  const bodyPart = raw.subarray(splitIdx + sepLen);
  const lines = headerPart.split(/\r?\n/);
  const s = String(lines[0] || "");
  const statusMatch = s.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
  const headers = {};
  lines.slice(1).forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  });
  return { statusCode, headers, body: bodyPart };
}

function decodeChunkedBody(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8");
  let cursor = 0;
  const parts = [];
  while (cursor < buf.length) {
    const rn = buf.indexOf("\r\n", cursor, "latin1");
    if (rn < 0) break;
    const sizeHex = buf.toString("latin1", cursor, rn).trim();
    const size = Number.parseInt(sizeHex, 16);
    if (!Number.isFinite(size)) break;
    cursor = rn + 2;
    if (size === 0) break;
    parts.push(buf.subarray(cursor, cursor + size));
    cursor += size + 2;
  }
  return parts.length > 0 ? Buffer.concat(parts) : buf;
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
          "Accept-Encoding": "identity",
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
          "Accept-Encoding: identity\r\n" +
          `Authorization: Bearer ${apiKey}\r\n` +
          `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n` +
          "Connection: close\r\n\r\n" +
          body;
        tlsSocket.write(reqText);
      });

      const rawChunks = [];
      tlsSocket.on("data", (chunk) => {
        rawChunks.push(Buffer.from(chunk));
      });
      tlsSocket.on("end", () => {
        try {
          const raw = Buffer.concat(rawChunks);
          const parsed = parseHttpResponse(raw);
          let decodedBody = Buffer.from(parsed.body);
          const te = String(parsed.headers["transfer-encoding"] || "").toLowerCase();
          if (te.includes("chunked")) decodedBody = decodeChunkedBody(decodedBody);
          const decodedText = Buffer.from(decodedBody).toString("utf8");
          if (parsed.statusCode < 200 || parsed.statusCode >= 300) {
            reject(new Error(`DeepSeek ${parsed.statusCode}: ${decodedText.slice(0, 300)}`));
            return;
          }
          resolve(decodedText);
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
    data = parseJsonLenient(body);
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
