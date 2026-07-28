#!/usr/bin/env node
/**
 * 用户留存 cohort 分析 → 单文件 HTML 报告(含热力图)。
 *
 * 数据全部来自本项目 Supabase 的 users / sessions / iap_entitlements 三张表,
 * 不引第三方追踪。所有 cohort 计算在 JS 里做,口径与 scripts/sql/cohort-retention.sql
 * / /api/admin/retention 对齐(UTC 日界、排除 status='pending' 预生成码)。
 *
 * 产出四块:
 *   1. 注册 cohort 周留存(按注册月分组,注册后第 0–12 周,是否有≥1次核心动作)
 *   2. 付费 cohort 周留存(按首次付费月分组,同上)
 *   3. 流失时点分布(替代图:最后活跃距今天数直方图 —— 考试日期未落库,见 README)
 *   4. 激活率(付费用户完成完整模考比例 + 付费后 7 天活跃天数分布)
 * 每张表/图下有一句话解读;报告顶部给出「留存曲线是否走平」的判定结论。
 *
 * 用法:
 *   # 连真库(需要环境变量或 .env.local 里的 service role key):
 *   node scripts/analytics/cohort-retention-report.mjs [输出路径.html]
 *   # 只看格式/自测算法(不连库,合成数据):
 *   node scripts/analytics/cohort-retention-report.mjs --demo [输出路径.html]
 *
 * 需要的环境变量(真库路径):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (service role,绕过 RLS 读全量)
 */

import fs from "node:fs";
import path from "node:path";

const MS_PER_DAY = 86400000;
const MAX_WEEKS = 12; // 注册/付费后第 0–12 周
const args = process.argv.slice(2);
const DEMO = args.includes("--demo");
const OUT = args.find((a) => a.endsWith(".html")) || "cohort-report.html";

// ── 时间工具(全 UTC,与 SQL 视图一致) ──────────────────────────────────────
function toUtcDayStr(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function dayNum(dayStr) {
  // 整数「天序号」,用于 offset 差值。dayStr = YYYY-MM-DD。
  return Math.floor(Date.parse(`${dayStr}T00:00:00Z`) / MS_PER_DAY);
}
function monthKey(dayStr) {
  return dayStr.slice(0, 7); // YYYY-MM
}
function weekOffset(activeDayN, anchorDayN) {
  return Math.floor((activeDayN - anchorDayN) / 7);
}

// ── .env.local 兜底加载(不依赖 dotenv) ────────────────────────────────────
function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── 拉数(真库,PostgREST 单请求 1000 行上限 → 按唯一列分页) ─────────────────
async function fetchAll(sb, table, columns, orderCol) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .order(orderCol, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function loadFromSupabase() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。\n" +
      "把它们放进 .env.local,或 export 到环境变量后重跑;或用 --demo 看格式。",
    );
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // status='pending' = 预生成但从未激活的登录码,排除(与 SQL 视图一致)。NULL 保留。
  const usersRaw = await fetchAll(sb, "users", "code,created_at,status,tier,tier_expires_at,exam_date", "code");
  const users = usersRaw.filter((u) => u.status !== "pending" && u.created_at);

  // details->>subtype 用 PostgREST 箭头选择,避免拉整个 details JSON。
  const sessions = await fetchAll(sb, "sessions", "user_code,type,date,sub:details->>subtype", "id");

  const entitlements = await fetchAll(sb, "iap_entitlements", "user_code,granted_at,id", "id");

  return { users, sessions, entitlements };
}

// ── 合成数据(--demo):造出一个「走平」cohort 和一个「衰减到零」cohort ─────────
function makeDemoData() {
  const users = [];
  const sessions = [];
  const entitlements = [];
  const base = Date.parse("2026-01-01T00:00:00Z");
  const day = (n) => new Date(base + n * MS_PER_DAY).toISOString();

  let uid = 0;
  // 5 个注册月;每月 60 人。前几个月留存「走平」(尾部稳定在 ~22%),
  // 最近月「持续衰减」——用于验证走平判定 + 让最近 cohort 呈未成熟态。
  const months = [0, 31, 59, 90, 120]; // 各月起始天序
  months.forEach((mStart, mi) => {
    const plateau = mi < 4; // 前 4 个月走平(演示留存地板),最近月衰减+未成熟
    for (let i = 0; i < 60; i++) {
      uid += 1;
      const code = `U${String(uid).padStart(4, "0")}`;
      const signup = mStart + (i % 28); // 摊到当月
      // 约 45% 的人填了考试日期(注册后 20–70 天),用于演示 #3 真图。
      const hasExam = uid % 20 < 9;
      const examOffsetFromSignup = 20 + (uid % 50);
      users.push({
        code,
        created_at: day(signup),
        status: "active",
        tier: "free",
        exam_date: hasExam ? day(signup + examOffsetFromSignup).slice(0, 10) : null,
      });

      // 每人的活跃周:week0 几乎都活跃,之后按曲线掉;plateau 组尾部有地板。
      for (let w = 0; w <= MAX_WEEKS; w++) {
        let p;
        if (plateau) p = w === 0 ? 0.95 : Math.max(0.22, 0.95 * Math.pow(0.75, w));
        else p = 0.95 * Math.pow(0.62, w); // 无地板,逼近 0
        // 用确定性伪随机(基于 uid+w)避免依赖 Math.random。
        const r = ((uid * 1103515245 + w * 12345 + 7) % 1000) / 1000;
        if (r < p) {
          const activeDay = signup + w * 7 + (uid % 5); // 落在该周内某天
          sessions.push({
            user_code: code,
            type: ["bs", "reading", "listening", "email", "discussion"][uid % 5],
            date: day(activeDay),
            sub: null,
          });
        }
      }
      // 20% 的人付费(首付在注册后 3–10 天),付费者里 55% 做过完整模考。
      if (uid % 5 === 0) {
        const payDay = signup + 3 + (uid % 8);
        entitlements.push({ user_code: code, granted_at: day(payDay), id: `e${uid}` });
        // 付费后 7 天内活跃天数:0–5 天不等
        const activeDays = uid % 6;
        for (let d = 0; d < activeDays; d++) {
          sessions.push({ user_code: code, type: "email", date: day(payDay + d), sub: null });
        }
        if (uid % 100 < 55) {
          // 完整模考:写作模考 type='mock' 或 subtype='mock'
          const isAdaptive = uid % 2 === 0;
          sessions.push({
            user_code: code,
            type: isAdaptive ? "reading" : "mock",
            date: day(payDay + 1),
            sub: isAdaptive ? "mock" : null,
          });
        }
      }
    }
  });
  return { users, sessions, entitlements };
}

// ── cohort 计算核心 ────────────────────────────────────────────────────────
// anchors: Map<userCode, anchorDayStr>  (注册日 或 首付日)
// activeDaysByUser: Map<userCode, Set<dayNum>>
// 返回 { rows:[{month,size,cells:[{week,active,pct,mature}]}], pooled:[{week,pct,mature}] }
function buildWeeklyCohort(anchors, activeDaysByUser, nowDayN) {
  // 按月分桶
  const byMonth = new Map(); // month -> { users:[{code,anchorN}], maxAnchorN }
  for (const [code, anchorDayStr] of anchors) {
    const m = monthKey(anchorDayStr);
    const anchorN = dayNum(anchorDayStr);
    if (!byMonth.has(m)) byMonth.set(m, { users: [], maxAnchorN: -Infinity });
    const b = byMonth.get(m);
    b.users.push({ code, anchorN });
    if (anchorN > b.maxAnchorN) b.maxAnchorN = anchorN;
  }

  const months = [...byMonth.keys()].sort();
  const rows = [];
  // pooled 累计器:仅纳入「该 week 已成熟」的 cohort
  const pooledRetained = new Array(MAX_WEEKS + 1).fill(0);
  const pooledDenom = new Array(MAX_WEEKS + 1).fill(0);

  for (const m of months) {
    const b = byMonth.get(m);
    const size = b.users.length;
    // 每周活跃用户数
    const activeByWeek = new Array(MAX_WEEKS + 1).fill(0);
    for (const { code, anchorN } of b.users) {
      const days = activeDaysByUser.get(code);
      if (!days) continue;
      const seenWeeks = new Set();
      for (const dN of days) {
        const w = weekOffset(dN, anchorN);
        if (w >= 0 && w <= MAX_WEEKS) seenWeeks.add(w);
      }
      for (const w of seenWeeks) activeByWeek[w] += 1;
    }
    const cells = [];
    for (let w = 0; w <= MAX_WEEKS; w++) {
      // 成熟:该 cohort 里最晚注册的人也已过完第 w 周(整周)。
      const mature = nowDayN - b.maxAnchorN >= (w + 1) * 7;
      const pct = size > 0 ? Math.round((activeByWeek[w] / size) * 1000) / 10 : null;
      cells.push({ week: w, active: activeByWeek[w], pct, mature });
      if (mature) {
        pooledRetained[w] += activeByWeek[w];
        pooledDenom[w] += size;
      }
    }
    rows.push({ month: m, size, cells });
  }

  const pooled = [];
  for (let w = 0; w <= MAX_WEEKS; w++) {
    const denom = pooledDenom[w];
    pooled.push({
      week: w,
      pct: denom > 0 ? Math.round((pooledRetained[w] / denom) * 1000) / 10 : null,
      mature: denom > 0,
    });
  }
  return { rows, pooled };
}

// 走平判定:看成熟 pooled 曲线尾部是否稳定在一条水平线上。
function analyzeFlatness(pooled) {
  const pts = pooled.filter((p) => p.mature && p.pct != null && p.week >= 1);
  if (pts.length < 4) {
    return { verdict: "数据不足", detail: "成熟周数太少(不足 4 周),无法判断曲线是否走平。", floor: null };
  }
  const last = pts[pts.length - 1];
  // 尾部(最后 4 个成熟周)的逐周变化幅度
  const tail = pts.slice(-4);
  const deltas = [];
  for (let i = 1; i < tail.length; i++) deltas.push(Math.abs(tail[i].pct - tail[i - 1].pct));
  const avgTailDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  // 早期跌幅(week1→week2)作对比基准
  const earlyDrop = pts.length >= 2 ? Math.abs(pts[1].pct - pts[0].pct) : 0;

  const floor = last.pct;
  let verdict;
  let detail;
  if (floor <= 2) {
    verdict = "持续下滑到接近零";
    detail = `留存在成熟尾周(第 ${last.week} 周)已跌到约 ${floor}%,没有形成稳定地板,曲线一路衰减逼近零 —— 说明产品目前留不住长期用户,几乎没有形成习惯性回访的核心人群。`;
  } else if (avgTailDelta <= 2 && avgTailDelta < earlyDrop / 2) {
    verdict = "走平(存在留存地板)";
    detail = `曲线在早期快速下跌后,尾部(最后 4 个成熟周)逐周变化仅约 ${avgTailDelta.toFixed(1)} 个百分点,稳定在约 ${floor}% 的水平线上 —— 这约 ${floor}% 是你的「留存地板」,代表已形成回访习惯的核心用户占比。`;
  } else {
    verdict = "仍在下滑(未见明确地板)";
    detail = `尾部逐周仍在变化约 ${avgTailDelta.toFixed(1)} 个百分点、当前约 ${floor}%,还没稳定成水平线;需要更多成熟周数才能确认是否会在某个水平走平,目前倾向于「还在缓慢下滑」。`;
  }
  return { verdict, detail, floor };
}

// ── 激活率(#4) ────────────────────────────────────────────────────────────
function buildActivation(firstPayByUser, fullMockUsers, activeDaysByUser, nowDayN) {
  const payers = [...firstPayByUser.keys()];
  const payerCount = payers.length;
  const activatedMock = payers.filter((c) => fullMockUsers.has(c)).length;

  // 付费后 7 天(含首付当天)活跃天数分布;仅纳入首付已满 7 天的成熟付费者。
  const hist = new Array(8).fill(0); // 0..7 天
  let maturePayers = 0;
  for (const code of payers) {
    const payN = dayNum(firstPayByUser.get(code));
    if (nowDayN - payN < 7) continue; // 窗口未满,排除
    maturePayers += 1;
    const days = activeDaysByUser.get(code) || new Set();
    let cnt = 0;
    for (let d = 0; d < 7; d++) if (days.has(payN + d)) cnt += 1;
    hist[cnt] += 1;
  }
  return {
    payerCount,
    activatedMock,
    activationPct: payerCount ? Math.round((activatedMock / payerCount) * 1000) / 10 : null,
    maturePayers,
    hist, // index = 活跃天数(0–7), value = 人数
  };
}

// ── 流失时点(#3 真图,当 exam_date 有数据时):最后活跃距「考试日期」天数分布 ──
// delta = 最后活跃日 - 考试日。负数=考前就没影(真流失),正数=考后不再用(正常)。
function buildExamChurn(examDateByUser, activeDaysByUser) {
  const buckets = [
    { label: "考前 15 天以上流失", lo: -Infinity, hi: -15 },
    { label: "考前 8–14 天", lo: -14, hi: -8 },
    { label: "考前 1 周内", lo: -7, hi: -1 },
    { label: "考后 1 周内(考完即走)", lo: 0, hi: 7 },
    { label: "考后 8–30 天", lo: 8, hi: 30 },
    { label: "考后 30 天以上(仍在用/复考)", lo: 31, hi: Infinity },
  ].map((b) => ({ ...b, count: 0 }));
  let total = 0;
  let preExam = 0;
  let postExam = 0;
  for (const [code, examStr] of examDateByUser) {
    const days = activeDaysByUser.get(code);
    if (!days || !days.size) continue;
    const examN = dayNum(examStr);
    const lastN = Math.max(...days);
    const delta = lastN - examN;
    total += 1;
    if (delta < 0) preExam += 1; else postExam += 1;
    const b = buckets.find((x) => delta >= x.lo && delta <= x.hi);
    if (b) b.count += 1;
  }
  return { buckets, total, preExam, postExam };
}

// ── 流失时点(#3 替代图):最后活跃距今天数分布 ───────────────────────────────
function buildChurnRecency(activeDaysByUser, nowDayN) {
  const buckets = [
    { label: "0–7 天(仍活跃)", lo: 0, hi: 7 },
    { label: "8–14 天", lo: 8, hi: 14 },
    { label: "15–30 天", lo: 15, hi: 30 },
    { label: "31–60 天", lo: 31, hi: 60 },
    { label: "61–90 天", lo: 61, hi: 90 },
    { label: "90 天以上(已流失)", lo: 91, hi: Infinity },
  ].map((b) => ({ ...b, count: 0 }));
  let total = 0;
  for (const days of activeDaysByUser.values()) {
    if (!days.size) continue;
    total += 1;
    const lastN = Math.max(...days);
    const age = nowDayN - lastN;
    const b = buckets.find((x) => age >= x.lo && age <= x.hi);
    if (b) b.count += 1;
  }
  return { buckets, total };
}

// ── 渲染 HTML ──────────────────────────────────────────────────────────────
function heatColor(pct) {
  if (pct == null) return "#f1f5f9";
  // 0% 浅 → 100% 深(teal 序列)。亮度 96%→30%。
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const light = 96 - t * 66;
  return `hsl(190, ${40 + t * 30}%, ${light}%)`;
}
function heatText(pct) {
  return pct != null && pct >= 45 ? "#ffffff" : "#0f172a";
}
function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderCohortTable(title, cohort, note) {
  const weeks = Array.from({ length: MAX_WEEKS + 1 }, (_, w) => w);
  const head = weeks.map((w) => `<th>W${w}</th>`).join("");
  const body = cohort.rows
    .slice()
    .reverse() // 最近月在上
    .map((r) => {
      const tds = r.cells
        .map((c) => {
          const bg = c.mature ? heatColor(c.pct) : "transparent";
          const cls = c.mature ? "" : " immature";
          const val = c.pct == null ? "·" : `${c.pct}`;
          const title = c.mature ? `${c.active}/${r.size}` : "未成熟(窗口未满)";
          return `<td class="cell${cls}" style="background:${bg};color:${c.mature ? heatText(c.pct) : "#94a3b8"}" title="${title}">${val}</td>`;
        })
        .join("");
      return `<tr><th class="mrow">${esc(r.month)}</th><td class="size">${r.size}</td>${tds}</tr>`;
    })
    .join("");
  return `
  <section>
    <h2>${esc(title)}</h2>
    <div class="tablewrap">
      <table class="heat">
        <thead><tr><th class="mrow">注册/付费月</th><th class="size">人数</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="note">${note}</p>
    <p class="legend"><span>低留存</span><span class="bar"></span><span>高留存</span> · 空心格 = 该周尚未成熟(时间未满,数值会继续累积,不参与结论)</p>
  </section>`;
}

function renderPooledCurve(title, pooled, flat) {
  const pts = pooled.filter((p) => p.mature && p.pct != null);
  const w = 640;
  const h = 220;
  const padL = 40;
  const padB = 28;
  const padT = 16;
  const maxW = MAX_WEEKS;
  const x = (wk) => padL + (wk / maxW) * (w - padL - 12);
  const y = (pct) => padT + (1 - pct / 100) * (h - padT - padB);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.week).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const dots = pts
    .map((p) => `<circle cx="${x(p.week).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="3" fill="#0e7490"/><text x="${x(p.week).toFixed(1)}" y="${(y(p.pct) - 7).toFixed(1)}" class="dotlab">${p.pct}</text>`)
    .join("");
  const grid = [0, 25, 50, 75, 100]
    .map((g) => `<line x1="${padL}" y1="${y(g).toFixed(1)}" x2="${w - 12}" y2="${y(g).toFixed(1)}" class="grid"/><text x="6" y="${(y(g) + 3).toFixed(1)}" class="axis">${g}%</text>`)
    .join("");
  const xlab = pts.map((p) => `<text x="${x(p.week).toFixed(1)}" y="${h - 8}" class="axis" text-anchor="middle">W${p.week}</text>`).join("");
  return `
  <section>
    <h2>${esc(title)}</h2>
    <svg viewBox="0 0 ${w} ${h}" class="curve" role="img">
      ${grid}
      <path d="${line}" fill="none" stroke="#0e7490" stroke-width="2"/>
      ${dots}${xlab}
    </svg>
    <div class="verdict ${flat.floor != null && flat.floor <= 2 ? "bad" : flat.verdict.startsWith("走平") ? "good" : "warn"}">
      <strong>走平判定:${esc(flat.verdict)}</strong><br>${flat.detail}
    </div>
  </section>`;
}

function renderBars(title, items, note, opts = {}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const rows = items
    .map((i) => {
      const wpct = (i.count / max) * 100;
      const label = opts.pctOfTotal && opts.total ? `${i.count} (${Math.round((i.count / opts.total) * 1000) / 10}%)` : `${i.count}`;
      return `<div class="brow"><div class="blab">${esc(i.label)}</div><div class="btrack"><div class="bfill" style="width:${wpct.toFixed(1)}%"></div></div><div class="bval">${label}</div></div>`;
    })
    .join("");
  return `
  <section>
    <h2>${esc(title)}</h2>
    <div class="bars">${rows}</div>
    <p class="note">${note}</p>
  </section>`;
}

function renderActivation(act) {
  const histItems = act.hist.map((count, days) => ({ label: `${days} 天`, count }));
  const kpi = `
    <div class="kpis">
      <div class="kpi"><div class="kn">${act.payerCount}</div><div class="kl">付费用户数</div></div>
      <div class="kpi"><div class="kn">${act.activationPct == null ? "—" : act.activationPct + "%"}</div><div class="kl">完成过完整模考的比例</div></div>
      <div class="kpi"><div class="kn">${act.activatedMock}</div><div class="kl">其中做过完整模考的人数</div></div>
    </div>`;
  const bars = renderBars(
    "付费后 7 天内活跃天数分布",
    histItems,
    `横轴为付费后 7 天(含付费当天)内有练习记录的天数,纵轴为人数。仅统计首付已满 7 天的 ${act.maturePayers} 名付费用户(窗口已完整)。集中在 0–1 天说明付费即流失,越往右说明付费后越黏。`,
  );
  return `
  <section>
    <h2>激活率(付费用户)</h2>
    ${kpi}
    <p class="note">「完整模考」= 写作模考(type=mock)或阅读/听力/口语自适应模考(subtype=mock)任一,历史上完成过至少一次即算。</p>
  </section>
  ${bars}`;
}

function renderReport(model) {
  const { generatedAt, counts, regCohort, payCohort, regFlat, payFlat, activation, churn, examChurn } = model;
  const hasExam = examChurn && examChurn.total > 0;
  const section3 = hasExam
    ? `
  <section>
    <h2>3 · 流失时点分布(相对考试日期)</h2>
    <div class="kpis">
      <div class="kpi"><div class="kn">${counts.withExamDate}</div><div class="kl">填了考试日期的用户</div></div>
      <div class="kpi"><div class="kn">${examChurn.total ? Math.round((examChurn.preExam / examChurn.total) * 1000) / 10 : 0}%</div><div class="kl">考前就流失(最后活跃早于考试日)</div></div>
      <div class="kpi"><div class="kn">${examChurn.total ? Math.round((examChurn.postExam / examChurn.total) * 1000) / 10 : 0}%</div><div class="kl">坚持到考后(正常毕业)</div></div>
    </div>
    ${renderBars(
      "",
      examChurn.buckets,
      `横轴为每个用户「最后一次练习距离其考试日期多少天」(负=考前,正=考后),纵轴为人数。共 ${examChurn.total} 名填了考试日期且有练习的用户。<strong>左侧(考前)= 真流失</strong>:还没考就放弃了,是要救的人;<strong>右侧(考后)= 正常毕业</strong>:考完自然不再用。若大量堆在「考前 15 天以上流失」,说明产品没能陪用户走到考试。`,
      { pctOfTotal: true, total: examChurn.total },
    ).replace("<h2></h2>", "")}
  </section>`
    : `
  <section>
    <h2>3 · 流失时点分布(替代图)</h2>
    <div class="warnbox">⚠ 「按考试日期分组的考前/考后流失」<strong>暂无数据</strong>:考试日期落库(study-plan-fields 迁移 + 前端写库)刚上线或迁移未跑,目前还没有用户的 <code>exam_date</code> 进库(历史数据补不回来,只统计上线后新填的)。下面先用「最后活跃距今天数」替代;等有用户填了考试日期,这里会自动切换成真正的考前/考后流失分布。</div>
    ${renderBars(
      "",
      churn.buckets,
      `横轴为每个活跃过的用户「最后一次练习距离今天多少天」,纵轴为人数。共 ${churn.total} 名活跃用户。堆在右侧(90 天以上)= 已实质流失;堆在左侧 = 近期仍活跃。`,
      { pctOfTotal: true, total: churn.total },
    ).replace("<h2></h2>", "")}
  </section>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>用户留存 Cohort 分析 — TreePractice</title>
<style>
  :root{--fg:#0f172a;--mut:#64748b;--line:#e2e8f0;--card:#fff;--bg:#f8fafc}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:920px;margin:0 auto;padding:32px 20px 80px}
  h1{font-size:24px;margin:0 0 4px}
  h2{font-size:17px;margin:0 0 12px;padding-top:6px}
  .sub{color:var(--mut);margin:0 0 24px}
  section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:0 0 22px}
  .note{color:var(--mut);font-size:13px;margin:12px 0 0}
  .tablewrap{overflow-x:auto}
  table.heat{border-collapse:collapse;font-size:12px;width:100%}
  table.heat th,table.heat td{border:1px solid var(--line);padding:5px 4px;text-align:center;min-width:34px}
  table.heat th.mrow{text-align:left;white-space:nowrap;background:#f1f5f9;position:sticky;left:0}
  table.heat td.size{color:var(--mut);font-variant-numeric:tabular-nums}
  .cell{font-variant-numeric:tabular-nums}
  .cell.immature{background-image:repeating-linear-gradient(45deg,#f8fafc,#f8fafc 3px,#eef2f7 3px,#eef2f7 6px)}
  .legend{display:flex;align-items:center;gap:8px;color:var(--mut);font-size:12px;margin-top:8px;flex-wrap:wrap}
  .legend .bar{display:inline-block;width:120px;height:10px;border-radius:5px;background:linear-gradient(90deg,hsl(190,40%,96%),hsl(190,70%,30%))}
  .curve{width:100%;height:auto;max-width:660px;display:block}
  .grid{stroke:#eef2f7;stroke-width:1}
  .axis{fill:#94a3b8;font-size:10px}
  .dotlab{fill:#0e7490;font-size:9px;text-anchor:middle}
  .verdict{margin-top:14px;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.7}
  .verdict.good{background:#ecfdf5;border:1px solid #a7f3d0}
  .verdict.warn{background:#fffbeb;border:1px solid #fde68a}
  .verdict.bad{background:#fef2f2;border:1px solid #fecaca}
  .kpis{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px}
  .kpi{flex:1;min-width:130px;background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:14px}
  .kn{font-size:26px;font-weight:800}
  .kl{color:var(--mut);font-size:12px;margin-top:2px}
  .bars{display:flex;flex-direction:column;gap:7px}
  .brow{display:grid;grid-template-columns:150px 1fr 76px;align-items:center;gap:10px}
  .blab{font-size:12px;color:var(--mut);text-align:right}
  .btrack{background:#f1f5f9;border-radius:5px;height:18px;overflow:hidden}
  .bfill{height:100%;background:linear-gradient(90deg,#0891b2,#0e7490);border-radius:5px}
  .bval{font-size:12px;font-variant-numeric:tabular-nums}
  .banner{background:#0f172a;color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:22px}
  .banner h2{color:#fff;margin:0 0 6px}
  .banner p{margin:4px 0;color:#cbd5e1;font-size:13px}
  .warnbox{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13px;color:#92400e}
  code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12px}
</style></head>
<body><div class="wrap">
  <h1>用户留存 Cohort 分析</h1>
  <p class="sub">TreePractice · 生成于 ${esc(generatedAt)} · 样本:${counts.users} 名有效用户 / ${counts.sessions} 条行为记录 / ${counts.payers} 名付费用户${DEMO ? " · <strong>⚠ 合成演示数据(--demo)</strong>" : ""}</p>

  <div class="banner">
    <h2>核心结论:留存曲线是否走平?</h2>
    <p><strong>注册 cohort:</strong> ${esc(regFlat.verdict)} — ${esc(stripTags(regFlat.detail))}</p>
    <p><strong>付费 cohort:</strong> ${esc(payFlat.verdict)} — ${esc(stripTags(payFlat.detail))}</p>
  </div>

  ${renderCohortTable(
    "1 · 注册 Cohort 周留存(按注册月分组)",
    regCohort,
    "每格 = 该注册月的用户中,在注册后第 N 周内完成过至少一次核心动作(任意练习/模考/AI 批改)的占比。颜色越深留存越高。从左到右看一行,就是这批用户随时间的留存衰减轨迹。",
  )}
  ${renderPooledCurve("↳ 注册 cohort 合并留存曲线(仅成熟周)", regCohort.pooled, regFlat)}

  ${renderCohortTable(
    "2 · 付费 Cohort 周留存(按首次付费月分组)",
    payCohort,
    "每格 = 该月首次付费的用户中,在首付后第 N 周内完成过至少一次核心动作的占比。付费用户理应比注册用户留存更高(已用钱投票),对比第 1 张表可看出付费是否真的带来更强黏性。",
  )}
  ${renderPooledCurve("↳ 付费 cohort 合并留存曲线(仅成熟周)", payCohort.pooled, payFlat)}

  ${renderActivation(activation)}

  ${section3}

  <p class="sub" style="margin-top:8px">口径:UTC 日界;排除 <code>status='pending'</code> 的预生成未激活登录码;首次付费 = 每人 <code>iap_entitlements.granted_at</code> 最小值;「核心动作」= 一条 <code>sessions</code> 记录(每次练习/模考/AI 批改都会写一行)。合并曲线只纳入「整周时间已过」的成熟 cohort,避免最近未满周把留存算低。</p>
</div></body></html>`;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, "");
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
function computeModel({ users, sessions, entitlements }) {
  const nowDayN = Math.floor(Date.now() / MS_PER_DAY);

  // 注册锚点
  const regAnchors = new Map(); // code -> signup dayStr
  for (const u of users) {
    const d = toUtcDayStr(u.created_at);
    if (d) regAnchors.set(u.code, d);
  }
  const validCodes = new Set(regAnchors.keys());

  // 活跃日(按用户去重到天);完整模考用户集
  const activeDaysByUser = new Map(); // code -> Set<dayNum>
  const fullMockUsers = new Set();
  for (const s of sessions) {
    if (!validCodes.has(s.user_code)) continue; // 只算有效用户
    const d = toUtcDayStr(s.date);
    if (!d) continue;
    if (!activeDaysByUser.has(s.user_code)) activeDaysByUser.set(s.user_code, new Set());
    activeDaysByUser.get(s.user_code).add(dayNum(d));
    if (s.type === "mock" || s.sub === "mock") fullMockUsers.add(s.user_code);
  }

  // 考试日期(exam_date 有值的用户;迁移未跑/未填时该 Map 为空 → 用替代图)
  const examDateByUser = new Map(); // code -> exam dayStr
  for (const u of users) {
    if (!validCodes.has(u.code) || !u.exam_date) continue;
    const d = toUtcDayStr(u.exam_date);
    if (d) examDateByUser.set(u.code, d);
  }

  // 首次付费(每人最早 granted_at)
  const firstPayByUser = new Map(); // code -> firstPay dayStr
  for (const e of entitlements) {
    if (!validCodes.has(e.user_code)) continue;
    const d = toUtcDayStr(e.granted_at);
    if (!d) continue;
    const prev = firstPayByUser.get(e.user_code);
    if (!prev || d < prev) firstPayByUser.set(e.user_code, d);
  }

  const regCohort = buildWeeklyCohort(regAnchors, activeDaysByUser, nowDayN);
  const payCohort = buildWeeklyCohort(firstPayByUser, activeDaysByUser, nowDayN);
  const regFlat = analyzeFlatness(regCohort.pooled);
  const payFlat = analyzeFlatness(payCohort.pooled);
  const activation = buildActivation(firstPayByUser, fullMockUsers, activeDaysByUser, nowDayN);
  const churn = buildChurnRecency(activeDaysByUser, nowDayN);
  const examChurn = buildExamChurn(examDateByUser, activeDaysByUser);

  return {
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
    counts: {
      users: validCodes.size,
      sessions: sessions.filter((s) => validCodes.has(s.user_code)).length,
      payers: firstPayByUser.size,
      withExamDate: examDateByUser.size,
    },
    regCohort,
    payCohort,
    regFlat,
    payFlat,
    activation,
    churn,
    examChurn,
  };
}

async function main() {
  const data = DEMO ? makeDemoData() : await loadFromSupabase();
  const model = computeModel(data);
  const html = renderReport(model);
  fs.writeFileSync(OUT, html);
  console.log(`✔ 报告已生成: ${OUT}`);
  console.log(`  有效用户 ${model.counts.users} · 行为记录 ${model.counts.sessions} · 付费用户 ${model.counts.payers}`);
  console.log(`  注册 cohort 走平判定: ${model.regFlat.verdict}`);
  console.log(`  付费 cohort 走平判定: ${model.payFlat.verdict}`);
  if (DEMO) console.log("  (⚠ 这是 --demo 合成数据,仅用于验证格式与算法)");
}

main().catch((e) => {
  console.error("[x] 生成失败:", e.message);
  process.exit(1);
});
