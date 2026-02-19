const fs = require("fs");
const path = require("path");
const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../lib/ai/deepseekHttp");

function loadEnv() {
  const paths = [path.join(process.cwd(), ".env.local"), path.join(process.cwd(), ".env")];
  for (const p of paths) {
    try {
      const txt = fs.readFileSync(p, "utf8");
      txt.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (!m) return;
        if (process.env[m[1]]) return;
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch {
      // ignore
    }
  }
}

async function main() {
  loadEnv();
  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  const proxy = resolveProxyUrl();
  console.log("DeepSeek check");
  console.log(`- key configured: ${key && key !== "your_key_here" ? "yes" : "no"}`);
  console.log(`- proxy: ${proxy || "(direct)"}`);

  if (!key || key === "your_key_here") {
    console.error("FAIL: DEEPSEEK_API_KEY is missing or still placeholder.");
    process.exit(1);
  }

  try {
    const content = await callDeepSeekViaCurl({
      apiKey: key,
      proxyUrl: proxy,
      timeoutMs: 15000,
      payload: {
        model: "deepseek-chat",
        max_tokens: 32,
        temperature: 0,
        stream: false,
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Reply with OK only." },
        ],
      },
    });
    console.log(`PASS: ${String(content || "").slice(0, 120)}`);
  } catch (e) {
    console.error(`FAIL: ${formatDeepSeekError(e)}`);
    process.exit(1);
  }
}

main();

