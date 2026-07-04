"use client";
// 个人题库（用户自助导入的题）—— 客户端**只读** + 映射 picker。
// 写入由 /my-bank 走 /api/user-bank；这里只负责把当前用户的个人题拉来、并入练习页 picker。
// 因为全局题库是构建期静态 import，无法服务每用户内容，所以这里运行时 fetch /api/user-bank。
// 任何失败/未登录都返回 []，绝不破坏全局 picker。
import { getSavedCode } from "../AuthContext";
import { extractShortTitle } from "../academicWriting/topicTitle";

// 'usr_' 是保留前缀：全局题库生成器都不会产出，保证个人题 id 不与全局 id 撞，
// 共享的 done-Set 也就不会误标。
export const USER_BANK_ID_RE = /^usr_[A-Z0-9]{4,8}_[0-9a-z]+_[0-9]+$/;
export function isUserBankId(id) {
  return USER_BANK_ID_RE.test(String(id || ""));
}

// Reading MCQ (rdl/ap) 守门共用：每题 stem 非空 + A-D 选项齐 + correct_answer ∈ A-D。
// 答案是硬要求 —— RDLTask 判分是 selected === correct_answer 严格串比，答案缺失的题
// 会把用户永远判错；导入侧（verify 代解 + 预览点选）保证落库前答案已解出。
const MCQ_ANSWER_KEYS = ["A", "B", "C", "D"];
function isCompleteMcqList(questions) {
  return Array.isArray(questions) && questions.length > 0 &&
    questions.every((q) => q && typeof q.stem === "string" && q.stem.trim() &&
      q.options && typeof q.options === "object" &&
      MCQ_ANSWER_KEYS.every((k) => typeof q.options[k] === "string" && q.options[k].trim()) &&
      MCQ_ANSWER_KEYS.includes(q.correct_answer));
}

// picker 标题兜底：与 app/reading/page.js firstLine() 同规则（首句/首行，70 字截断）。
function firstLineOf(text) {
  const line = String(text || "").split(/[\n.!?]/).filter(Boolean)[0]?.trim() || "";
  return line.length > 70 ? line.slice(0, 67) + "..." : line;
}

/**
 * 拉当前用户某题型的个人库。返回 RAW promptData 数组，每条带稳定 id（= 服务端 item_id），
 * 该 id 同时驱动 picker 选择与 stashPromptSnapshot 交接。
 * @param {'discussion'|'email'|'repeat'|'interview'|'build'|'rdl'|'ap'} type
 */
export async function fetchPersonalBank(type) {
  if (typeof window === "undefined") return [];
  const code = getSavedCode();
  if (!code || !/^[A-Z0-9]{6}$/.test(code)) return [];
  try {
    const res = await fetch(`/api/user-bank?type=${encodeURIComponent(type)}&code=${encodeURIComponent(code)}`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json?.ok || !Array.isArray(json.items)) return [];
    return json.items
      .map((row) => {
        const data = row?.data;
        if (!data || typeof data !== "object") return null;
        const id = String(row.item_id || (row.id != null ? `usr_${code}_${row.id}` : "") || data.id || "").trim();
        if (!id) return null;
        return { ...data, id };
      })
      .filter(Boolean)
      .filter((d) => {
        // Per-type shape gate — last line of defense before the task component consumes
        // user JSON. Each new type MUST add a real check (not just a field existence probe).
        if (type === "email") return !!d.scenario;
        if (type === "build") {
          // Build a Sentence: must have an answer + at least a 2-tile chunk bag. The task
          // component's runtime prepareQuestions() drops anything that still can't be assembled,
          // so this is the minimal "is it a build question at all" shape probe.
          return !!d.answer && typeof d.answer === "string" && d.answer.trim() &&
            Array.isArray(d.chunks) && d.chunks.length >= 2;
        }
        if (type === "repeat") {
          return Array.isArray(d.sentences) && d.sentences.length > 0 &&
            d.sentences.every((s) => s && typeof s.sentence === "string" && s.sentence.trim());
        }
        if (type === "interview") {
          return Array.isArray(d.questions) && d.questions.length > 0 &&
            d.questions.every((q) => q && typeof q.question === "string" && q.question.trim());
        }
        if (type === "rdl") {
          // 日常阅读：原文 + 完整可判分的 MCQ 列表（RDLTask 直接消费该形状）。
          return typeof d.text === "string" && d.text.trim() && isCompleteMcqList(d.questions);
        }
        if (type === "ap") {
          // 学术短文：AP 在练习页穿 RDL 马甲（page.js 做 passage→text 适配），守门按 bank 契约查 passage。
          return typeof d.passage === "string" && d.passage.trim() && isCompleteMcqList(d.questions);
        }
        return !!d?.professor?.text; // discussion (default)
      });
  } catch {
    return [];
  }
}

/** 映射成 TopicPicker 的归一化 item，带「我的」标签以便和全局题区分。
 * NOTE: 'build'（连词成句）**不需要**在此加分支——BS 练习页不走 TopicPicker，而是用
 * app/build-sentence/page.js 内置的语法分类卡；个人 build 题由该页直接组成短 batch 消费，
 * 不经过 picker 归一化。故此函数只覆盖走 picker 的题型（discussion/email/repeat/interview）。 */
export function mapPersonalToPicker(type, rawItems) {
  return (Array.isArray(rawItems) ? rawItems : []).map((p) => {
    if (type === "email") {
      const sentences = String(p.scenario || "").split(/(?<=[.!?])\s+/).filter(Boolean);
      const firstSentence = sentences[0]?.trim() || p.scenario || "";
      const title = firstSentence.length > 70 ? firstSentence.slice(0, 67) + "..." : firstSentence;
      const rest = sentences.slice(1).join(" ").trim();
      return { id: p.id, tag: "我的", title: title || "(导入的邮件题)", subtitle: rest || p.scenario || "", personal: true };
    }
    if (type === "repeat") {
      // Speaking picker item keys = buildRepeatTopics(): { id, tag, title, subtitle }.
      const first = String(p.sentences?.[0]?.sentence || "").trim();
      const title = p.scenario || (first.length > 60 ? first.slice(0, 57) + "..." : first) || "(导入的复述题)";
      return {
        id: p.id, tag: "我的",
        title,
        subtitle: `${p.sentences?.length || 0} sentences`,
        personal: true,
      };
    }
    if (type === "interview") {
      // Speaking picker item keys = buildInterviewTopics(): { id, tag, title, subtitle }.
      const first = String(p.questions?.[0]?.question || "").trim();
      const title = p.topic || (first.length > 60 ? first.slice(0, 57) + "..." : first) || "(导入的面试题)";
      return {
        id: p.id, tag: "我的",
        title,
        subtitle: `${p.questions?.length || 0} questions`,
        personal: true,
      };
    }
    if (type === "rdl") {
      // Reading picker item keys = buildRDLTopics(): { id, tag, title, subtitle }（page.js:93-100）。
      return {
        id: p.id, tag: "我的",
        title: p.format_metadata?.title || p.format_metadata?.subject || firstLineOf(p.text) || "(导入的日常阅读)",
        subtitle: `${p.questions?.length || 0} 题`,
        personal: true,
      };
    }
    if (type === "ap") {
      // Reading picker item keys = buildAPTopics(): { id, tag, title, subtitle }（page.js:102-109）。
      return {
        id: p.id, tag: "我的",
        title: firstLineOf(p.passage) || "(导入的学术短文)",
        subtitle: p.subtopic || p.topic || `${p.questions?.length || 0} 题`,
        personal: true,
      };
    }
    const ptext = String(p?.professor?.text || "");
    return {
      id: p.id,
      tag: "我的",
      title: extractShortTitle(ptext) || "(导入的讨论题)",
      subtitle: ptext.length > 120 ? ptext.slice(0, 120) + "..." : ptext,
      personal: true,
    };
  });
}
