// 真题模考的用户可见错误文案（纯函数，三个模考壳共用）。
// 错误码来自 app/api/real-mock-exam/route.js 与 lib/realMockExam/client.js 的 RealMockError。
// kind 决定错误卡给哪些按钮：
//   transient      —— 网络 / 服务抖动，给「重试」
//   exhausted      —— 未做过的真题凑不齐一整套，重试没用，只能先回真题专区单练
//   active-attempt —— 同科还有一份没做完的卷（别的设备 / 页面），只能显式「放弃那份并重新组卷」
//   dead-attempt   —— 这份卷已结束 / 过期 / 不存在，继续作答不可能，只能重新组卷
//   account        —— 未登录 / 非 Pro / 账号不可用，重试没用

// 组卷缺口的展示名与量词。rdl2 / rdl3 是组卷器内部按题数分的桶（planner.js 的 bucket）。
const DEFICIT_LABELS = {
  ctw: ["填词", "篇"],
  rdl2: ["两题日常阅读", "篇"],
  rdl3: ["三题日常阅读", "篇"],
  rdl: ["日常阅读", "篇"],
  ap: ["学术阅读", "篇"],
  lcr: ["听力应答", "题"],
  lc: ["听力对话", "段"],
  la: ["听力通知", "段"],
  lat: ["听力讲座", "段"],
  repeat: ["口语跟读", "套"],
  interview: ["口语访谈", "套"],
  bs: ["造句", "题"],
  email: ["邮件", "题"],
  discussion: ["学术讨论", "题"],
};

export const REAL_MOCK_DEAD_ATTEMPT_CODES = new Set(["ATTEMPT_FINISHED", "ATTEMPT_EXPIRED", "ATTEMPT_NOT_FOUND"]);
const ACCOUNT_CODES = new Set(["PRO_REQUIRED", "LOGIN_REQUIRED", "INVALID_USER"]);

/**
 * 组卷缺口 → 每个题型一句中文。服务端按 upper / lower 两条路线各算一遍，同一题型可能出现两次，
 * 这里按题型合并、取较大的需求量，所以不会再出现「ctw需3、可用2；ctw需3、可用2」。
 */
export function describeRealMockDeficits(deficits) {
  const byType = new Map();
  for (const d of Array.isArray(deficits) ? deficits : []) {
    const type = String(d?.taskType || d?.type || "");
    if (!type) continue;
    const need = Number(d?.need ?? d?.required) || 0;
    const available = Math.max(0, Number(d?.available) || 0);
    const prev = byType.get(type);
    if (!prev || need > prev.need) byType.set(type, { need, available });
  }
  const parts = [];
  for (const [type, { need, available }] of byType) {
    if (type === "material-conflict") {
      parts.push("剩下的题目之间内容有重叠，凑不出互不重复的一整套");
      continue;
    }
    if (need <= available) continue;
    const [label, unit] = DEFICIT_LABELS[type] || [type, "题"];
    parts.push(`${label}还差 ${need - available} ${unit}（一套需要 ${need} ${unit}，你没做过的只剩 ${available} ${unit}）`);
  }
  return parts;
}

/** RealMockError（或任意 Error）→ { kind, code, canRetry, activeAttemptId, message }。 */
export function describeRealMockError(error, fallback = "真题模考请求失败，请稍后重试。") {
  const code = String(error?.code || "");
  if (code === "REAL_MOCK_EXHAUSTED") {
    const parts = describeRealMockDeficits(error?.deficits);
    return {
      kind: "exhausted", code, canRetry: false, activeAttemptId: null,
      message: `你没做过的真题已经凑不齐一套完整试卷${parts.length ? `：${parts.join("；")}` : ""}。可以先在真题专区按题型单独练习。`,
    };
  }
  if (code === "ACTIVE_ATTEMPT") {
    return {
      kind: "active-attempt", code, canRetry: false, activeAttemptId: error?.activeAttemptId || null,
      message: "你还有一份没做完的同科真题模考（可能在另一台设备或另一个页面上）。可以回到那里继续；如果放弃，那份试卷会被结束，已经展示过的题仍计为已做。",
    };
  }
  if (REAL_MOCK_DEAD_ATTEMPT_CODES.has(code)) {
    return {
      kind: "dead-attempt", code, canRetry: false, activeAttemptId: null,
      message: `${error?.message || "这份试卷已经结束或过期。"}本卷无法继续作答，可以重新组一套。`,
    };
  }
  if (ACCOUNT_CODES.has(code)) {
    return { kind: "account", code, canRetry: false, activeAttemptId: null, message: error?.message || fallback };
  }
  return { kind: "transient", code, canRetry: true, activeAttemptId: null, message: error?.message || fallback };
}

/** 放弃另一份进行中的试卷前的确认文案（window.confirm）。 */
export const RELEASE_ACTIVE_ATTEMPT_CONFIRM = "确定放弃那份没做完的试卷吗？它会被立即结束（如果正在另一台设备上作答，那边将无法继续），已经展示过的题仍计为已做。";
