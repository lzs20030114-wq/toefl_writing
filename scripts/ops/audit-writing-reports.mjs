#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// 写作 AI 批改报告「套话」审计脚本（只读）
//
// 用途：
//   量化 Supabase `sessions` 表里写作练习（discussion / email）批改报告
//   （details.feedback）里各类「套话/模板化」信号的出现率，作为
//   lib/ai/ + components/writing/ 改造前后的对比基线。
//   —— 改造前跑一次留基线，改造后再跑一次对比同一批指标，看有没有真的改善。
//
// 只读声明：
//   本脚本只对 Supabase 执行 SELECT，绝不 UPDATE/DELETE/INSERT，
//   也不改动仓库内任何其他文件（写作报告的解析/校准逻辑正由同事改动中，
//   本脚本不导入、不触碰 lib/ai/ 或 components/writing/ 的任何代码）。
//
// 用法：
//   node scripts/ops/audit-writing-reports.mjs [--limit 300] [--since 2026-01-01]
//                                               [--out data/claudeGen/reports/xxx.json]
//                                               [--no-write]
//
//   --limit N     按 date 倒序取最近 N 条 discussion/email 记录（默认 300）
//   --since DATE  只取 date >= DATE 的记录（YYYY-MM-DD，可选）
//   --out PATH    JSON 输出路径（默认 data/claudeGen/reports/writing-report-audit-<时间戳>.json）
//   --no-write    只在终端打印汇总表，不写 JSON 文件
//
// 需要的环境变量（.env.local）：
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// 假设：
//   - sessions.date 可能是 timestamptz 或 ISO 字符串，按字典序做 desc 排序/gte
//     过滤对两种存储形式都成立（ISO 8601 字符串本身是字典序可比较的）。
//   - 只统计 details.feedback 是对象的记录；非对象/为空的行会被跳过并计数。
//   - 分段边界按 feedback.score（0–5，步长 0.5）：≤3 / 3.5–4 / 4.5–5；
//     score 缺失或不在这三段内归入 "unknown"。
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  getRequiredEnv,
  loadEnv,
  parseArgs,
  repoRoot,
  writeJson,
} from "./_shared.mjs";

// ── 硬编码套话信号 ──
// 2026-09-19：这两处注入/替换已从产线删除（calibration.js 的 addBlueRefinements、
// parse.js parseActionSection 的三句兜底文案）。这里的字面量保留下来，是因为本脚本
// 要在**历史 sessions 记录**里数它们出现的比例——改造后新记录应当一路读到 0，
// 旧记录仍读得出改造前的基线。请勿因为「代码里已经没有这些字符串」就删掉它们。
// ① 校准层兜底蓝标（原 lib/ai/calibration.js addBlueRefinements，已删除）
const INJECTED_BLUE_MESSAGE = "Can be refined for smoother flow and more precise expression.";
// ② 解析层短板兜底（原 lib/ai/parse.js parseActionSection，已删除）
const FALLBACK_ACTION_TITLE = "语言与任务表达可提升";
const FALLBACK_ORIGIN_MARK = "（原建议：";
const TEMPLATE_ACTION_KEYWORDS = ["句型", "模板", "可以使用", "可用"];
const HAS_CJK = /[一-鿿]/;

const WRITING_TYPES = ["discussion", "email"];
const SCORE_BANDS = ["≤3", "3.5–4", "4.5–5", "unknown"];

function printHelp() {
  console.log(
    [
      "Usage: node scripts/ops/audit-writing-reports.mjs [options]",
      "",
      "  --limit N     最近 N 条 discussion/email 记录 (默认 300)",
      "  --since DATE  仅取 date >= DATE 的记录 (YYYY-MM-DD)",
      "  --out PATH    JSON 输出路径",
      "  --no-write    只打印终端汇总，不写文件",
      "  --help        显示本帮助",
    ].join("\n")
  );
}

// ── 小工具 ──────────────────────────────────────────────────────────────
function maskUserCode(code) {
  const s = String(code || "").trim();
  if (!s) return "(空)";
  if (s.length <= 4) return "*".repeat(s.length);
  return `${s.slice(0, 2)}**${s.slice(-2)}`;
}

function scoreBand(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 3) return "≤3";
  if (n >= 3.5 && n <= 4) return "3.5–4";
  if (n >= 4.5 && n <= 5) return "4.5–5";
  return "unknown";
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function topN(list, n) {
  const counts = new Map();
  for (const item of list) {
    if (!item) continue;
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([text, count]) => ({ text, count }));
}

function fmtPct(x) {
  return x === null || x === undefined || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x, digits = 1) {
  return x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(digits);
}

function mdTable(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

function defaultOutPath() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return resolve(repoRoot, "data/claudeGen/reports", `writing-report-audit-${stamp}.json`);
}

// ── 单份报告 → 逐项布尔/计数 ────────────────────────────────────────────
function analyzeReport(feedback) {
  const annotations = Array.isArray(feedback?.annotationParsed?.annotations)
    ? feedback.annotationParsed.annotations
    : [];
  const actions = Array.isArray(feedback?.actions) ? feedback.actions : [];
  const patterns = Array.isArray(feedback?.patterns) ? feedback.patterns : [];

  const injectedBlue = annotations.some(
    (a) => a?.level === "blue" && String(a?.message || "") === INJECTED_BLUE_MESSAGE
  );

  const fallbackAction = actions.some((a) => {
    if (String(a?.title || "").includes(FALLBACK_ACTION_TITLE)) return true;
    return [a?.title, a?.importance, a?.action].some((v) =>
      String(v || "").includes(FALLBACK_ORIGIN_MARK)
    );
  });

  const englishAction = actions.some((a) =>
    [a?.title, a?.importance, a?.action].some((v) => {
      const s = String(v || "").trim();
      return s.length > 0 && !HAS_CJK.test(s);
    })
  );

  const templateAction = actions.some((a) => {
    const s = String(a?.action || "");
    return TEMPLATE_ACTION_KEYWORDS.some((k) => s.includes(k));
  });

  const actionTitles = actions.map((a) => String(a?.title || "").trim()).filter(Boolean);
  const summary = String(feedback?.summary || "").trim();

  const patternTags = patterns.map((p) => ({
    tag: String(p?.tag || "").trim() || "(未命名)",
    count: Number(p?.count) || 0,
  }));

  const rawCounts = feedback?.annotationCounts;
  const annCounts =
    rawCounts && typeof rawCounts === "object"
      ? {
          red: Number(rawCounts.red) || 0,
          orange: Number(rawCounts.orange) || 0,
          blue: Number(rawCounts.blue) || 0,
        }
      : annotations.reduce(
          (acc, a) => {
            if (a?.level === "red") acc.red += 1;
            else if (a?.level === "orange") acc.orange += 1;
            else if (a?.level === "blue") acc.blue += 1;
            return acc;
          },
          { red: 0, orange: 0, blue: 0 }
        );
  const zeroAnnotations = annCounts.red + annCounts.orange + annCounts.blue === 0;

  const modelEssay = String(feedback?.comparison?.modelEssay || "").trim();
  const modelEssayEmpty = modelEssay.length === 0;
  const comparisonRecovered = feedback?.comparisonRecovered === true;

  const dims = feedback?.rubric?.dimensions || {};
  const dimKeys = ["task_fulfillment", "organization_coherence", "language_use"];
  const rubricPresent = Boolean(feedback?.rubric && typeof feedback.rubric === "object");
  const rubricReasonMissing = dimKeys.some((k) => !String(dims?.[k]?.reason || "").trim());

  const errorTriagePresent = feedback?.errorTriage !== undefined && feedback?.errorTriage !== null;

  return {
    injectedBlue,
    fallbackAction,
    englishAction,
    templateAction,
    actionCount: actions.length,
    actionTitles,
    summary,
    patternTags,
    annCounts,
    zeroAnnotations,
    modelEssayEmpty,
    comparisonRecovered,
    rubricPresent,
    rubricReasonMissing,
    errorTriagePresent,
  };
}

// ── 一组报告 → 汇总指标 ─────────────────────────────────────────────────
function aggregateGroup(items) {
  const n = items.length;
  if (n === 0) {
    return {
      n: 0,
      injectedBlueRate: null,
      fallbackActionRate: null,
      englishActionRate: null,
      templateActionRate: null,
      summaryTotal: 0,
      summaryDedupRate: null,
      topSummaries: [],
      titleTotal: 0,
      titleDedupRate: null,
      topTitles: [],
      annotation: {
        redMean: null,
        redMedian: null,
        orangeMean: null,
        orangeMedian: null,
        blueMean: null,
        blueMedian: null,
        zeroAnnotationRate: null,
      },
      modelEssayEmptyRate: null,
      comparisonRecoveredRate: null,
      rubricReasonMissingRate: null,
      errorTriagePresentRate: null,
    };
  }

  const rate = (pred) => items.filter(pred).length / n;
  const summaries = items.map((x) => x.summary).filter(Boolean);
  const allTitles = items.flatMap((x) => x.actionTitles);
  const reds = items.map((x) => x.annCounts.red);
  const oranges = items.map((x) => x.annCounts.orange);
  const blues = items.map((x) => x.annCounts.blue);

  return {
    n,
    injectedBlueRate: rate((x) => x.injectedBlue),
    fallbackActionRate: rate((x) => x.fallbackAction),
    englishActionRate: rate((x) => x.englishAction),
    templateActionRate: rate((x) => x.templateAction),
    summaryTotal: summaries.length,
    summaryDedupRate: summaries.length ? new Set(summaries).size / summaries.length : null,
    topSummaries: topN(summaries, 10),
    titleTotal: allTitles.length,
    titleDedupRate: allTitles.length ? new Set(allTitles).size / allTitles.length : null,
    topTitles: topN(allTitles, 10),
    annotation: {
      redMean: mean(reds),
      redMedian: median(reds),
      orangeMean: mean(oranges),
      orangeMedian: median(oranges),
      blueMean: mean(blues),
      blueMedian: median(blues),
      zeroAnnotationRate: rate((x) => x.zeroAnnotations),
    },
    modelEssayEmptyRate: rate((x) => x.modelEssayEmpty),
    comparisonRecoveredRate: rate((x) => x.comparisonRecovered),
    rubricReasonMissingRate: rate((x) => x.rubricReasonMissing),
    errorTriagePresentRate: rate((x) => x.errorTriagePresent),
  };
}

function tagDistribution(items) {
  const counts = new Map();
  let total = 0;
  for (const x of items) {
    for (const p of x.patternTags) {
      counts.set(p.tag, (counts.get(p.tag) || 0) + 1);
      total += 1;
    }
  }
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count, share: total ? count / total : null }));
  const top3Share = total ? tags.slice(0, 3).reduce((a, e) => a + e.count, 0) / total : null;
  return { total, tags, top3Share };
}

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("--help")) {
    printHelp();
    return;
  }

  loadEnv();

  let supabaseUrl;
  let serviceRoleKey;
  try {
    supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  } catch (err) {
    console.error("缺少 Supabase 环境变量，无法连接数据库。");
    console.error("请在仓库根目录的 .env.local 中配置：");
    console.error("  NEXT_PUBLIC_SUPABASE_URL=...");
    console.error("  SUPABASE_SERVICE_ROLE_KEY=...");
    console.error(`(原始错误: ${err.message})`);
    process.exit(1);
    return;
  }

  const limitArg = Number(args.get("--limit", 300));
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 300;

  const sinceArg = args.get("--since", null);
  let since = null;
  if (sinceArg && sinceArg !== true) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sinceArg))) {
      console.error(`--since 格式应为 YYYY-MM-DD，收到: ${sinceArg}`);
      process.exit(1);
      return;
    }
    since = String(sinceArg);
  }

  const noWrite = args.has("--no-write");
  const outArg = args.get("--out", null);
  const outPath = outArg && outArg !== true ? resolve(repoRoot, String(outArg)) : defaultOutPath();

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase
    .from("sessions")
    .select("user_code,type,date,details")
    .in("type", WRITING_TYPES)
    .not("details->feedback", "is", null)
    .order("date", { ascending: false })
    .limit(limit);
  if (since) {
    query = query.gte("date", `${since}T00:00:00.000Z`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase 查询失败: ${error.message}`);
  }

  const rows = data || [];
  let skipped = 0;
  // fullReports: 含 summary/actionTitles 原文，只用于服务端聚合(topN/去重率/tag 分布)，
  // 本身不整体写入 JSON。
  const fullReports = [];

  for (const row of rows) {
    const feedback = row?.details?.feedback;
    if (!feedback || typeof feedback !== "object") {
      skipped += 1;
      continue;
    }
    const analysis = analyzeReport(feedback);
    const type = WRITING_TYPES.includes(row?.type) ? row.type : "other";
    const score = Number(feedback?.score);
    const band = scoreBand(feedback?.score);
    fullReports.push({
      user_code: maskUserCode(row?.user_code),
      type,
      date: row?.date || null,
      score: Number.isFinite(score) ? score : null,
      band,
      ...analysis,
    });
  }

  // reports: 写入 JSON 的逐份记录，只保留布尔/计数——summary/actionTitles 原文
  // 只允许出现在聚合结果的 topSummaries/topTitles 里，这里去掉。
  const reports = fullReports.map(({ summary, actionTitles, ...safe }) => safe);

  // ── 分组（聚合都基于 fullReports，以便算 topN 摘要/标题）──────────────
  const overall = aggregateGroup(fullReports);
  const byType = {};
  for (const t of WRITING_TYPES) {
    byType[t] = aggregateGroup(fullReports.filter((r) => r.type === t));
  }
  const byBand = {};
  for (const b of SCORE_BANDS) {
    byBand[b] = aggregateGroup(fullReports.filter((r) => r.band === b));
  }
  const byBandType = {};
  for (const b of SCORE_BANDS) {
    for (const t of WRITING_TYPES) {
      byBandType[`${b}|${t}`] = aggregateGroup(fullReports.filter((r) => r.band === b && r.type === t));
    }
  }
  const patternsByType = {};
  for (const t of WRITING_TYPES) {
    patternsByType[t] = tagDistribution(fullReports.filter((r) => r.type === t));
  }
  patternsByType.overall = tagDistribution(fullReports);

  const dates = fullReports.map((r) => r.date).filter(Boolean).sort();
  const meta = {
    generatedAt: new Date().toISOString(),
    limit,
    since,
    rowsFetched: rows.length,
    rowsValid: reports.length,
    rowsSkipped: skipped,
    dateRange: dates.length ? { earliest: dates[0], latest: dates[dates.length - 1] } : null,
    countsByType: Object.fromEntries(WRITING_TYPES.map((t) => [t, reports.filter((r) => r.type === t).length])),
    countsByBand: Object.fromEntries(SCORE_BANDS.map((b) => [b, reports.filter((r) => r.band === b).length])),
    constants: {
      injectedBlueMessage: INJECTED_BLUE_MESSAGE,
      fallbackActionTitle: FALLBACK_ACTION_TITLE,
      fallbackOriginMark: FALLBACK_ORIGIN_MARK,
      templateActionKeywords: TEMPLATE_ACTION_KEYWORDS,
    },
  };

  // ── 控制台中文汇总 ───────────────────────────────────────────────────
  console.log("# 写作批改报告「套话」审计 — 基线快照\n");
  console.log(
    `生成时间: ${meta.generatedAt} | 样本: ${meta.rowsValid} 份 (discussion: ${meta.countsByType.discussion}, email: ${meta.countsByType.email}, 跳过: ${meta.rowsSkipped}) | limit=${limit}${since ? `, since=${since}` : ""}`
  );
  if (meta.dateRange) {
    console.log(`时间范围: ${meta.dateRange.earliest} ~ ${meta.dateRange.latest}`);
  }
  console.log("");

  console.log("## 分段 × 题型 — 套话/模板信号\n");
  {
    const headers = ["分段", "题型", "份数", "蓝标注入率", "兜底短板率", "英文短板率", "模板化行动率", "总评去重率", "标题去重率"];
    const rows2 = [];
    for (const b of SCORE_BANDS) {
      for (const t of WRITING_TYPES) {
        const g = byBandType[`${b}|${t}`];
        rows2.push([
          b,
          t,
          g.n,
          fmtPct(g.injectedBlueRate),
          fmtPct(g.fallbackActionRate),
          fmtPct(g.englishActionRate),
          fmtPct(g.templateActionRate),
          fmtPct(g.summaryDedupRate),
          fmtPct(g.titleDedupRate),
        ]);
      }
    }
    for (const t of WRITING_TYPES) {
      const g = byType[t];
      rows2.push([
        "全部",
        t,
        g.n,
        fmtPct(g.injectedBlueRate),
        fmtPct(g.fallbackActionRate),
        fmtPct(g.englishActionRate),
        fmtPct(g.templateActionRate),
        fmtPct(g.summaryDedupRate),
        fmtPct(g.titleDedupRate),
      ]);
    }
    rows2.push([
      "全部",
      "全部",
      overall.n,
      fmtPct(overall.injectedBlueRate),
      fmtPct(overall.fallbackActionRate),
      fmtPct(overall.englishActionRate),
      fmtPct(overall.templateActionRate),
      fmtPct(overall.summaryDedupRate),
      fmtPct(overall.titleDedupRate),
    ]);
    console.log(mdTable(headers, rows2));
    console.log("");
  }

  console.log("## 分段 × 题型 — 辅助质量信号\n");
  {
    const headers = ["分段", "题型", "份数", "零批注占比", "范文缺失率", "范文借用率", "三维度理由缺失率", "errorTriage存在率"];
    const rows2 = [];
    for (const b of SCORE_BANDS) {
      for (const t of WRITING_TYPES) {
        const g = byBandType[`${b}|${t}`];
        rows2.push([
          b,
          t,
          g.n,
          fmtPct(g.annotation.zeroAnnotationRate),
          fmtPct(g.modelEssayEmptyRate),
          fmtPct(g.comparisonRecoveredRate),
          fmtPct(g.rubricReasonMissingRate),
          fmtPct(g.errorTriagePresentRate),
        ]);
      }
    }
    rows2.push([
      "全部",
      "全部",
      overall.n,
      fmtPct(overall.annotation.zeroAnnotationRate),
      fmtPct(overall.modelEssayEmptyRate),
      fmtPct(overall.comparisonRecoveredRate),
      fmtPct(overall.rubricReasonMissingRate),
      fmtPct(overall.errorTriagePresentRate),
    ]);
    console.log(mdTable(headers, rows2));
    console.log("");
  }

  console.log("## 批注总数分布（按分段；均值/中位数）\n");
  {
    const headers = ["分段", "份数", "red 均值/中位", "orange 均值/中位", "blue 均值/中位", "零批注占比"];
    const rows2 = SCORE_BANDS.map((b) => {
      const g = byBand[b];
      return [
        b,
        g.n,
        `${fmtNum(g.annotation.redMean)}/${fmtNum(g.annotation.redMedian)}`,
        `${fmtNum(g.annotation.orangeMean)}/${fmtNum(g.annotation.orangeMedian)}`,
        `${fmtNum(g.annotation.blueMean)}/${fmtNum(g.annotation.blueMedian)}`,
        fmtPct(g.annotation.zeroAnnotationRate),
      ];
    });
    rows2.push([
      "全部",
      overall.n,
      `${fmtNum(overall.annotation.redMean)}/${fmtNum(overall.annotation.redMedian)}`,
      `${fmtNum(overall.annotation.orangeMean)}/${fmtNum(overall.annotation.orangeMedian)}`,
      `${fmtNum(overall.annotation.blueMean)}/${fmtNum(overall.annotation.blueMedian)}`,
      fmtPct(overall.annotation.zeroAnnotationRate),
    ]);
    console.log(mdTable(headers, rows2));
    console.log("");
  }

  console.log("## PATTERNS 标签分布（按题型，前 8 + Top3 合计占比）\n");
  for (const t of WRITING_TYPES) {
    const dist = patternsByType[t];
    console.log(`### ${t} (共 ${dist.total} 条标签, Top3 合计占比 ${fmtPct(dist.top3Share)})`);
    if (dist.tags.length) {
      console.log(
        mdTable(
          ["tag", "次数", "占比"],
          dist.tags.slice(0, 8).map((x) => [x.tag, x.count, fmtPct(x.share)])
        )
      );
    } else {
      console.log("(无数据)");
    }
    console.log("");
  }

  console.log("## 总评 Top 10（原文 + 出现次数）\n");
  overall.topSummaries.forEach((x, i) => console.log(`${i + 1}. (${x.count}次) ${x.text}`));
  console.log("");

  console.log("## 短板标题 Top 10（原文 + 出现次数）\n");
  overall.topTitles.forEach((x, i) => console.log(`${i + 1}. (${x.count}次) ${x.text}`));
  console.log("");

  if (noWrite) {
    console.log("(--no-write：未写入 JSON 文件)");
    return;
  }

  const outDir = dirname(outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeJson(outPath, {
    meta,
    overall,
    byType,
    byBand,
    byBandType,
    patternsByType,
    reports,
  });

  console.log(`已写入: ${outPath}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
