#!/usr/bin/env node
/**
 * 真题录入 —— 全链路驱动（一期：只跑不依赖音频的科目）。
 *
 * 依次对每套卷跑：
 *   1) ingest_set.py --json      确定性对齐（零 token）
 *   2) structure_set.mjs         语义转写 + 盖答案（DeepSeek）
 *   3) audit_answers.mjs         盲审（DeepSeek，独立作答比对）
 *
 * 一期科目锁死在 reading,writing：听力/口语的题面依赖音频，且提取链路盲审只有约 60%
 * （根因是逐页 OCR 串栏），没达标就不进产线。
 *
 * 花钱这件事上有三道闸（2026-09-05 事故的直接产物：账户欠费时整批照常跑完还 exit 0，
 * 每个题块拿到 402 被当普通失败，空结果把 9/1 花钱跑出来的产物静默覆盖，40 秒毁四套卷）：
 *   1) 开跑前查一次 DeepSeek 余额，不可用就一套都不跑（--skip-audit 也查，结构化本身就花钱）；
 *   2) 每套跑完再查一次，前后差 = 这套的实际花费，最后汇总总花费与均值——这是充多少钱的依据；
 *   3) 子进程退出码 3（系统性 API 失败 / 拒绝覆盖既有产物）→ 整批立即停，不再往下烧。
 *
 * 用法:
 *   node scripts/realbank/run_pipeline.mjs --sets "3.10新托福真题,5.10新托福真题"
 *   node scripts/realbank/run_pipeline.mjs --all
 *   node scripts/realbank/run_pipeline.mjs --all --skip-audit     # 只出结构化，盲审另跑
 *   node scripts/realbank/run_pipeline.mjs --all --resume          # 跳过已跑完盲审的卷
 *
 * 退出码：0 正常；2 用法错误；3 余额预检未过 / 某套系统性失败导致整批中止。
 */
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import tls from "tls";
import { URL } from "url";
import { spawn } from "child_process";

// --src / REALBANK_SRC 覆盖源目录（默认行为不变，仅影响 --all 的卷名枚举与传给
// ingest_set.py 的 --src；structure_set.mjs / audit_answers.mjs 本身不读源目录）。
const argvSrcIdx = process.argv.indexOf("--src");
const SRC = (argvSrcIdx >= 0 && process.argv[argvSrcIdx + 1])
  || process.env.REALBANK_SRC
  || "D:\\桌面\\【2026改后全科真题】（持续更新中）";
const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const PY = "D:\\python\\python";
const SECTIONS = "reading,writing";
const BALANCE_URL = "https://api.deepseek.com/user/balance";
// 子进程用它表示「系统性失败」，和普通的非零退出区分开。
const EXIT_SYSTEMIC = 3;

/** 和 structure_set.mjs 同一套读法：.env.local 优先，已存在的进程变量不覆盖。 */
function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(process.cwd(), p), "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* 没有 .env 就靠进程环境变量 */ }
  }
}

const resolveProxy = () =>
  String(process.env.DEEPSEEK_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();

/* ── 余额查询（GET /user/balance，免费） ─────────────────────────────────── */
// 走和 DeepSeek 调用同一个代理（DEEPSEEK_PROXY_URL / HTTPS_PROXY）。不走代理的话国内
// 直连拿不到余额，会把「查不到」误判成「没钱」，反过来又把能跑的批次拦下。

function decodeChunked(buf) {
  const parts = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const rn = buf.indexOf("\r\n", cursor, "latin1");
    if (rn < 0) break;
    const size = Number.parseInt(buf.toString("latin1", cursor, rn).trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(buf.subarray(rn + 2, rn + 2 + size));
    cursor = rn + 2 + size + 2;
  }
  return parts.length ? Buffer.concat(parts) : buf;
}

function parseRawHttp(raw) {
  const text = raw.toString("latin1");
  let i = text.indexOf("\r\n\r\n");
  let sep = 4;
  if (i < 0) { i = text.indexOf("\n\n"); sep = 2; }
  if (i < 0) throw new Error("非法 HTTP 响应");
  const head = text.slice(0, i);
  let body = raw.subarray(i + sep);
  if (/transfer-encoding:\s*chunked/i.test(head)) body = decodeChunked(body);
  return {
    statusCode: Number((head.match(/^HTTP\/\d\.\d\s+(\d{3})/i) || [])[1] || 0),
    body: body.toString("utf8"),
  };
}

function getDirect(urlStr, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(urlStr, { method: "GET", headers, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d.toString("utf8"); });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("余额请求超时")));
    req.on("error", reject);
    req.end();
  });
}

function getViaProxy(urlStr, headers, timeoutMs, proxyUrl) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const target = new URL(urlStr);
    const connectHeaders = { Host: `${target.hostname}:443` };
    if (proxy.username || proxy.password) {
      const token = Buffer.from(
        `${decodeURIComponent(proxy.username || "")}:${decodeURIComponent(proxy.password || "")}`,
      ).toString("base64");
      connectHeaders["Proxy-Authorization"] = `Basic ${token}`;
    }
    const connectReq = http.request({
      host: proxy.hostname, port: Number(proxy.port || 80), method: "CONNECT",
      path: `${target.hostname}:443`, headers: connectHeaders, timeout: timeoutMs,
    });
    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: ${res.statusCode}`));
        return;
      }
      const sock = tls.connect({ socket, servername: target.hostname });
      sock.setTimeout(timeoutMs);
      sock.on("timeout", () => sock.destroy(new Error("余额请求超时（代理）")));
      sock.on("error", reject);
      sock.once("secureConnect", () => {
        sock.write(
          `GET ${target.pathname} HTTP/1.1\r\nHost: ${target.hostname}\r\n`
          + Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("")
          + "Accept-Encoding: identity\r\nConnection: close\r\n\r\n",
        );
      });
      const chunks = [];
      sock.on("data", (c) => chunks.push(Buffer.from(c)));
      sock.on("end", () => {
        try { resolve(parseRawHttp(Buffer.concat(chunks))); } catch (e) { reject(e); }
      });
    });
    connectReq.on("timeout", () => connectReq.destroy(new Error("代理 CONNECT 超时")));
    connectReq.on("error", reject);
    connectReq.end();
  });
}

/**
 * 查余额。返回 { ok, available, total, currency, reason }。
 * ok=false 一律当「不能开跑」处理：查不到余额就不该往里烧钱。
 */
async function fetchBalance() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, reason: "环境里没有 DEEPSEEK_API_KEY（.env.local 也没读到）" };
  const proxy = resolveProxy();
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const r = /^https?:\/\//i.test(proxy)
      ? await getViaProxy(BALANCE_URL, headers, 20000, proxy)
      : await getDirect(BALANCE_URL, headers, 20000);
    let json = null;
    try { json = JSON.parse(r.body); } catch { /* 下面按非 JSON 处理 */ }
    if (r.statusCode !== 200 || !json) {
      return { ok: false, statusCode: r.statusCode, reason: `余额接口返回 HTTP ${r.statusCode}：${String(r.body).slice(0, 200)}` };
    }
    const info = (json.balance_infos || [])[0] || {};
    return {
      ok: true,
      available: json.is_available === true,
      total: Number(info.total_balance),
      currency: info.currency || "",
      raw: json,
    };
  } catch (e) {
    return { ok: false, reason: `余额接口不可达：${e?.message || e}${proxy ? `（代理 ${proxy}）` : "（直连）"}` };
  }
}

const money = (n, cur) => (Number.isFinite(n) ? `${n.toFixed(2)}${cur ? ` ${cur}` : ""}` : "?");

/* ── 子进程 ──────────────────────────────────────────────────────────────── */
function run(cmd, args, label) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      shell: false,
    });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => resolve({ code, out, label }));
  });
}

/** --resume 的「已完成」判据：盲审产物存在，且含 audited 明细数组。 */
function isDone(setname) {
  const f = path.join(OUT_DIR, `${setname}.audit.json`);
  if (!fs.existsSync(f)) return false;
  try {
    return Array.isArray(JSON.parse(fs.readFileSync(f, "utf8")).audited);
  } catch {
    return false;   // 半截 / 坏 JSON 一律当没跑过：重跑一遍比留着烂数据强
  }
}

function pick(out, re) {
  const m = out.match(re);
  return m ? m[1] : null;
}

/** 子进程输出尾巴，用来在中止时把真实原因带给用户，而不是只说一句「失败」。 */
const tail = (out, n = 12) =>
  String(out || "").split(/\r?\n/).filter((l) => l.trim()).slice(-n).map((l) => `    ${l}`).join("\n");

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const skipAudit = args.includes("--skip-audit");
  // --resume：铺 54 套要跑几小时，中途断了不该从头再烧一遍 token。
  // 「已完成」的判据是 <卷>.audit.json 存在**且**带 audited 明细数组——光有文件不算数：
  // 旧格式的 audit.json 没有明细，build_bank 照样认不了它，跳过等于把坑埋住。
  const resume = args.includes("--resume");
  let sets;
  if (args.includes("--all")) {
    sets = fs.readdirSync(SRC).filter((d) => {
      try { return fs.statSync(path.join(SRC, d)).isDirectory(); } catch { return false; }
    });
  } else {
    const i = args.indexOf("--sets");
    if (i < 0) { console.error("用法: --all 或 --sets \"卷名,卷名\""); process.exit(2); }
    sets = String(args[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  // ── 余额预检 ──
  // --skip-audit 也要查：结构化本身就是掏钱的那一步。查不到余额同样不跑——
  // 「不确定有没有钱」和「确定没钱」在后果上是一回事（跑出一批空结果）。
  const pre = await fetchBalance();
  if (!pre.ok) {
    console.error(`[余额预检未过] ${pre.reason}`);
    console.error("一套都没跑。先把 key / 网络 / 代理弄好再来。");
    process.exit(EXIT_SYSTEMIC);
  }
  console.log(`DeepSeek 余额：${money(pre.total, pre.currency)}（is_available=${pre.available}）`);
  if (!pre.available || !(pre.total > 0)) {
    console.error("[余额预检未过] 账户当前不可用（余额不足或被冻结），一套都没跑。");
    console.error("  充值后再跑；现在跑只会得到一批 402 空结果。");
    process.exit(EXIT_SYSTEMIC);
  }

  console.log(`共 ${sets.length} 套卷；科目 [${SECTIONS}]；盲审 ${skipAudit ? "跳过" : "开"}${resume ? "；--resume 开" : ""}\n`);

  const rows = [];
  let skipped = 0;
  let lastTotal = pre.total;              // 上一次读到的余额，用来算每套花费
  const startTotal = pre.total;
  let stoppedAt = null;                   // 整批中止在哪一套
  for (const [i, s] of sets.entries()) {
    const t0 = process.hrtime.bigint();
    process.stdout.write(`[${i + 1}/${sets.length}] ${s} … `);

    if (resume && isDone(s)) {
      skipped += 1;
      console.log("跳过(已完成)");
      rows.push({ set: s, skipped: true });
      continue;
    }

    const a = await run(PY, ["scripts/realbank/ingest_set.py", s, "--json", "--src", SRC], "ingest");
    if (a.code !== 0) { console.log(`对齐失败`); rows.push({ set: s, err: "ingest" }); continue; }

    const b = await run("node", ["scripts/realbank/structure_set.mjs", s, "--sections", SECTIONS], "structure");
    if (b.code === EXIT_SYSTEMIC) {
      console.log("结构化中止（系统性失败）");
      console.log(tail(b.out));
      rows.push({ set: s, err: "structure-systemic" });
      stoppedAt = s;
      break;
    }
    if (b.code !== 0) { console.log(`结构化失败`); rows.push({ set: s, err: "structure" }); continue; }
    const ok = Number(pick(b.out, /最终:.*?ok:\s*(\d+)/s) || pick(b.out, /第一轮:.*?ok:\s*(\d+)/s) || 0);
    const flagged = Number(pick(b.out, /最终:.*?flagged:\s*(\d+)/s) || 0);

    let agree = null, denom = null, auditErr = null;
    if (!skipAudit) {
      const c = await run("node", ["scripts/realbank/audit_answers.mjs", s], "audit");
      if (c.code === EXIT_SYSTEMIC) {
        console.log("盲审中止（系统性失败）");
        console.log(tail(c.out));
        rows.push({ set: s, ok, flagged, err: "audit-systemic" });
        stoppedAt = s;
        break;
      }
      if (c.code !== 0) {
        auditErr = `退出码 ${c.code}`;
      } else {
        // 匹配不到「一致 N/M」就是没审成（没有可审题目 / 模型一题都没答）。
        // 以前这里直接 Number(null) 得到 NaN 还照常打印 NaN/NaN，把「没结果」伪装成结果。
        const a1 = pick(c.out, /一致 (\d+)\//);
        const d1 = pick(c.out, /一致 \d+\/(\d+)/);
        if (a1 === null || d1 === null) {
          auditErr = pick(c.out, /(盲审无结果[^\r\n]*)/) || "盲审无结果（输出里没有「一致 N/M」）";
        } else {
          agree = Number(a1); denom = Number(d1);
        }
      }
    }

    // 本套花费 = 跑前余额 - 跑后余额。查不到就留空，不猜。
    let cost = null;
    const post = await fetchBalance();
    if (post.ok && Number.isFinite(post.total)) {
      cost = lastTotal - post.total;
      lastTotal = post.total;
    }

    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    const rate = denom ? `${(agree / denom * 100).toFixed(0)}%` : "-";
    const auditCell = auditErr ? `盲审 ${auditErr}` : `盲审 ${agree ?? "-"}/${denom ?? "-"} (${rate})`;
    console.log(`结构化 ok=${ok} flagged=${flagged}  ${auditCell}  `
      + `${cost === null ? "花费 ?" : `花费 ${money(cost, post.currency)}`}  ${secs.toFixed(0)}s`);
    rows.push({ set: s, ok, flagged, agree, denom, auditErr, cost, secs: +secs.toFixed(0) });

    // 跑着跑着钱花光了：下一套只会得到 402 空结果，就地停。
    if (post.ok && (!post.available || !(post.total > 0))) {
      console.error(`\n[中止] 余额已耗尽（${money(post.total, post.currency)}，is_available=${post.available}），后面的卷不再跑。`);
      stoppedAt = s;
      break;
    }
  }

  const done = rows.filter((r) => !r.err && !r.skipped);
  const okSum = done.reduce((n, r) => n + (r.ok || 0), 0);
  const agSum = done.reduce((n, r) => n + (r.agree || 0), 0);
  const dnSum = done.reduce((n, r) => n + (r.denom || 0), 0);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`本轮跑了 ${done.length}/${sets.length} 套${skipped ? `（--resume 跳过已完成 ${skipped} 套）` : ""}；结构化通过 ${okSum} 块`);
  if (dnSum) console.log(`盲审总计 ${agSum}/${dnSum} = ${(agSum / dnSum * 100).toFixed(1)}%`);
  const noAudit = rows.filter((r) => r.auditErr).map((r) => `${r.set}(${String(r.auditErr).slice(0, 24)})`);
  if (noAudit.length) console.log(`盲审没出结果的卷 ${noAudit.length} 套: ${noAudit.slice(0, 10).join("  ")}`);
  const bad = done.filter((r) => r.denom && r.agree / r.denom < 0.9).map((r) => `${r.set}(${(r.agree / r.denom * 100).toFixed(0)}%)`);
  if (bad.length) console.log(`一致率 <90% 的卷 ${bad.length} 套: ${bad.slice(0, 10).join("  ")}`);

  // 花费汇总 —— 用户决定充多少钱就看这两行。
  const priced = rows.filter((r) => Number.isFinite(r.cost));
  const spent = startTotal - lastTotal;
  console.log(`余额 ${money(startTotal, pre.currency)} → ${money(lastTotal, pre.currency)}；本批花费 ${money(spent, pre.currency)}`);
  if (priced.length) {
    console.log(`计价 ${priced.length} 套，平均每套 ${money(spent / priced.length, pre.currency)}`
      + `；按此均值，剩余余额还能跑约 ${spent > 0 ? Math.floor(lastTotal / (spent / priced.length)) : "∞"} 套`);
  }
  if (stoppedAt) console.log(`⚠ 整批中止在「${stoppedAt}」，其后的卷一套都没跑。`);

  fs.writeFileSync(path.join(OUT_DIR, "_pipeline-report.json"), JSON.stringify({
    sections: SECTIONS, startBalance: startTotal, endBalance: lastTotal,
    spent: Number.isFinite(spent) ? +spent.toFixed(4) : null, stoppedAt, rows,
  }, null, 2), "utf8");
  console.log(`报告 → ${path.join(OUT_DIR, "_pipeline-report.json")}`);
  if (stoppedAt) process.exit(EXIT_SYSTEMIC);
}

main().catch((e) => { console.error(e); process.exit(1); });
