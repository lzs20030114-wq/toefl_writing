"use client";
import React, { useState, useRef, useMemo, useCallback } from "react";
import { getSavedCode } from "../../lib/AuthContext";
import { QA_PRESETS, QA_MAX_TURNS, presetText, parseAnswer, sentenceLabel, buildEvidence } from "../../lib/qa/questionQa";
import { analogyMaterials, pastItemMaterials } from "../../lib/qa/pastQuestions";
import { isSentenceSelection } from "../../lib/reading/sentenceSelection";
import { useQuestionQa } from "./useQuestionQa";

// 练习记录逐题「继续追问」窗口：挂在阅读选择题「AI 讲解」下面，默认收起。
// 计划见 docs/rag-qa-implementation-plan.md §4。回答只按纯文本渲染（不许 innerHTML）；
// 出处 [S#] 显示成「第 x 段第 y 句」并可点开原句，核不上的出处 / 引文降级显示。

const THEMES = {
  review: { text: "#4338CA", bd: "#C7D2FE", bg: "#EEF2FF", solid: "#6366F1", cardBg: "#F7F7FE", cardBd: "#E0E7FF", body: "#1a2420" },
  default: { text: "#0c4a6e", bd: "#bae6fd", bg: "#f0f9ff", solid: "#0284c7", cardBg: "#f8fcff", cardBd: "#bae6fd", body: "#0c4a6e" },
};
const MUTED = "#6b7280";


function Tag({ children, tone, onClick, title, testId }) {
  const tones = {
    ok: { color: "#4338CA", background: "#EEF2FF", border: "1px solid #C7D2FE" },
    bad: { color: "#9CA3AF", background: "#F3F4F6", border: "1px solid #E5E7EB" },
    other: { color: "#065F46", background: "#ECFDF5", border: "1px solid #A7F3D0" },
  };
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      title={title}
      style={{ ...tones[tone], display: "inline", fontSize: 11, fontWeight: 700, lineHeight: 1.4, borderRadius: 4, padding: "0 4px", margin: "0 2px", cursor: onClick ? "pointer" : "default", verticalAlign: "baseline" }}
    >
      {children}
    </button>
  );
}

function Answer({ text, sentences, materials, related, dict, mistakes = 0, past = null, theme, testId = "qa-answer" }) {
  const [open, setOpen] = useState(null);
  // 举一反三那一轮：对比题的题干、选项、依据句也算可引的材料
  const allMaterials = useMemo(() => (past?.length ? [...materials, ...analogyMaterials({ items: past })] : materials), [materials, past]);
  const segments = useMemo(() => parseAnswer(text, sentences, allMaterials, { mistakes, dict, past: past?.length ? past.map(pastItemMaterials) : 0 }), [text, sentences, allMaterials, mistakes, dict, past]);
  const bad = segments.filter((s) => (s.type === "cite" || s.type === "quote") && !s.valid).length;
  const toggle = (k) => setOpen((cur) => (cur === k ? null : k));
  const byId = useMemo(() => new Map(sentences.map((s) => [s.id, s])), [sentences]);

  let detailBox = null;
  if (open?.startsWith("S")) {
    const s = byId.get(open);
    if (s) detailBox = <div data-testid="qa-cite-sentence" style={{ fontSize: 12.5, lineHeight: 1.6, color: "#374151", fontFamily: "Georgia, serif" }}><span style={{ fontWeight: 700, color: theme.text, marginRight: 6, fontFamily: "inherit" }}>{sentenceLabel(s, sentences)}</span>{s.text}</div>;
  } else if (open && /^题\d+$/.test(open)) {
    const m = past?.[Number(open.slice(1)) - 1];
    if (m) detailBox = <div data-testid="qa-cite-past" style={{ fontSize: 12, lineHeight: 1.6, color: "#374151" }}><div>{`${m.date} ${m.isCorrect ? "做对" : "做错"}　${m.stem}`}</div><div style={{ color: m.isCorrect ? "#047857" : "#B91C1C" }}>{`你选：${m.userAnswer || "未作答"}`}</div>{m.isCorrect ? null : <div style={{ color: "#047857" }}>{`正确：${m.correctAnswer}`}</div>}{m.evidence?.length ? <div style={{ fontFamily: "Georgia, serif" }}>{`依据句：${m.evidence.join(" ")}`}</div> : null}</div>;
  } else if (open?.startsWith("错题")) {
    const m = related?.items?.[Number(open.slice(2)) - 1];
    if (m) detailBox = <div data-testid="qa-cite-mistake" style={{ fontSize: 12, lineHeight: 1.6, color: "#374151" }}><div>{`${m.date} ${m.stem}`}</div><div style={{ color: "#B91C1C" }}>{`当时选：${m.userAnswer || "未作答"}`}</div><div style={{ color: "#047857" }}>{`正确：${m.correctAnswer}`}</div></div>;
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div data-testid={testId} style={{ fontSize: 12.5, lineHeight: 1.75, color: theme.body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {segments.map((s, i) => {
          if (s.type === "text") return <React.Fragment key={i}>{s.text}</React.Fragment>;
          if (s.type === "quote") {
            return s.valid
              ? <React.Fragment key={i}>{s.text}</React.Fragment>
              : <span key={i} data-testid="qa-bad-quote" title="这段引文在本题原文里找不到" style={{ textDecoration: "underline dashed #D97706", textUnderlineOffset: 3 }}>{s.text}</span>;
          }
          if (s.kind === "sentence") {
            const sent = byId.get(s.id);
            return s.valid
              ? <Tag key={i} tone="ok" testId="qa-cite" onClick={() => toggle(s.id)}>{sentenceLabel(sent, sentences)}</Tag>
              : <Tag key={i} tone="bad" testId="qa-cite-bad" title="这条出处核对不上，请以原文为准">{`${sent ? sentenceLabel(sent, sentences) : "出处"}?`}</Tag>;
          }
          if (s.kind === "past") {
            return s.valid
              ? <Tag key={i} tone="other" testId="qa-cite-past-tag" onClick={() => toggle(s.id)}>{s.id}</Tag>
              : <Tag key={i} tone="bad" testId="qa-cite-bad" title="这条出处核对不上，请以原文为准">{`${s.id}?`}</Tag>;
          }
          if (s.kind === "mistake") {
            return s.valid
              ? <Tag key={i} tone="other" onClick={() => toggle(s.id)}>{s.id}</Tag>
              : <Tag key={i} tone="bad" testId="qa-cite-bad" title="这条出处核对不上，请以原文为准">{`${s.id}?`}</Tag>;
          }
          const name = s.kind === "answer" ? "答案" : "词典";
          return s.valid
            ? <Tag key={i} tone="other">{name}</Tag>
            : <Tag key={i} tone="bad" testId="qa-cite-bad" title="这条出处核对不上，请以原文为准">{`${name}?`}</Tag>;
        })}
      </div>
      {detailBox ? <div style={{ marginTop: 6, padding: "6px 10px", borderLeft: `3px solid ${theme.bd}`, background: "#fff", borderRadius: 4 }}>{detailBox}</div> : null}
      {bad > 0 ? <div data-testid="qa-bad-note" style={{ marginTop: 4, fontSize: 11, color: MUTED }}>{`有 ${bad} 处出处或引文核对不上，已标灰，请以原文为准`}</div> : null}
    </div>
  );
}

/**
 * 第一轮「AI 讲解」也用同一个核对器显示：出处变成可点开的「第 2 段第 3 句」，核不上的标灰。
 * 证据包和追问同源（buildEvidence），所以讲解里的 [S编号] 与追问、原文页上的句号一致。
 */
export function CitedText({ text, detail, variant }) {
  const theme = THEMES[variant === "review" ? "review" : "default"];
  const ev = useMemo(() => buildEvidence(detail), [detail]);
  return <Answer text={text} sentences={ev.sentences} materials={ev.materials} theme={theme} testId="explain-answer" />;
}

function ReportBox({ detail, answer, onDone }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | done | error | nologin
  const send = async () => {
    const userCode = String(getSavedCode() || "").trim();
    if (!userCode) { setState("nologin"); return; }
    setState("sending");
    const parts = [
      "[答疑上报]",
      `qid=${detail?.qid || ""}`,
      `题干：${String(detail?.stem || "").slice(0, 200)}`,
      `标准答案：${detail?.correct || ""}`,
      `作答：${detail?.selected || "未作答"}`,
      `AI 原话：${String(answer || "").slice(0, 300)}`,
      `补充：${note.trim()}`,
    ];
    const content = parts.join(" | ").slice(0, 2000);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, content, page: typeof location !== "undefined" ? location.pathname : "/" }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };
  if (state === "done") return <div style={{ fontSize: 12, color: "#047857" }}>已上报，谢谢！我们核对后会修正。</div>;
  return (
    <div data-testid="qa-report" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        placeholder="可以补充一句哪里有问题（选填）"
        style={{ fontSize: 16, padding: "6px 8px", border: "1px solid #D1D5DB", borderRadius: 6, minWidth: 0 }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={send} disabled={state === "sending"} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#DC2626", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>{state === "sending" ? "提交中…" : "提交上报"}</button>
        <button type="button" onClick={onDone} style={{ fontSize: 12, color: MUTED, background: "none", border: "none", cursor: "pointer" }}>取消</button>
        {state === "error" ? <span style={{ fontSize: 12, color: "#E11D48" }}>提交失败，请稍后再试</span> : null}
        {state === "nologin" ? <span style={{ fontSize: 12, color: "#E11D48" }}>登录后才能上报</span> : null}
      </div>
    </div>
  );
}

export function QuestionQaPanel({ detail, firstExplain, variant, defaultExpanded = false }) {
  const theme = THEMES[variant === "review" ? "review" : "default"];
  const qa = useQuestionQa(detail, firstExplain);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [input, setInput] = useState("");
  const [lastAsk, setLastAsk] = useState(null);
  // 正在上报哪一条回答的原话（null = 没在上报）。点哪条回答下的「上报这题」就带哪条，页脚链接带最后一轮。
  const [reporting, setReporting] = useState(null);
  const inputRef = useRef(null);

  const answered = !!detail?.selected;
  const ss = isSentenceSelection(detail?.question) || isSentenceSelection({ question_type: detail?.questionType, options: detail?.options });
  const selectedLabel = ss ? "那一句" : String(detail?.selected || "");
  const atTurnCap = qa.turns.length >= QA_MAX_TURNS;
  const atDailyCap = !atTurnCap && qa.dailyLeft <= 0;
  const disabled = qa.loading || atTurnCap || atDailyCap;

  const send = useCallback(async (question, opts = {}) => {
    const args = { question, opts };
    setLastAsk(args);
    const ok = await qa.ask(args.question, args.opts);
    if (ok) {
      // 等回答的时候用户可能已经开始打下一问：只有框里还是刚发出的那句才清空。
      if (opts.fromInput) setInput((cur) => (cur.trim() === question ? "" : cur));
      setLastAsk(null);
    }
    return ok;
  }, [qa]);

  // 「我是这么想的…」只预填输入框；用户补完发出去时仍按这个预设走（要附同类错题）。
  const thinkingPrefix = presetText("my-thinking", { selectedLabel });
  const sendInput = () => {
    const q = input.trim();
    if (!q || disabled) return;
    send(q, { fromInput: true, presetId: q.startsWith(thinkingPrefix) ? "my-thinking" : null });
  };

  // 还没追问时，页脚上报带的是第一轮讲解（用户质疑的就是它）。
  const lastAnswer = qa.turns.length ? qa.turns[qa.turns.length - 1].a : (firstExplain || "");
  const onPreset = (p) => {
    if (p.id === "my-thinking") {
      setInput(thinkingPrefix);
      setTimeout(() => {
        const el = inputRef.current;
        if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
      }, 0);
      return;
    }
    send(presetText(p.id), { presetId: p.id, label: p.label });
  };

  // 「讲简单点」是把上一轮再讲一遍：还没有讲解、也没追问过时没有可简化的东西。
  const presets = QA_PRESETS.filter((p) => (!p.needsAnswer || answered) && (!p.needsPast || qa.pastCount > 0) && (p.id !== "simpler" || firstExplain || qa.turns.length));

  if (!qa.sentences.length) return null;

  if (!expanded) {
    const n = qa.turns.length;
    const chip = { fontSize: 12, color: theme.text, background: "#fff", border: `1px solid ${theme.bd}`, borderRadius: 999, padding: "3px 10px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 };
    // 问过的题：一个按钮回到对话。没问过：预设问题直接露在讲解下面，点一下就问（不用先展开）。
    if (n) {
      return (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            data-testid="qa-open"
            onClick={() => setExpanded(true)}
            style={{ fontSize: 12, fontWeight: 700, color: theme.text, background: theme.bg, border: `1px solid ${theme.bd}`, borderRadius: 8, padding: "4px 12px", cursor: "pointer" }}
          >
            {`继续追问（已问 ${n} 轮）`}
          </button>
        </div>
      );
    }
    return (
      <div data-testid="qa-entry" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>还没懂？接着问：</span>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`qa-entry-${p.id}`}
            disabled={disabled}
            onClick={() => { setExpanded(true); onPreset(p); }}
            style={chip}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          data-testid="qa-open"
          onClick={() => {
            setExpanded(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          style={{ ...chip, cursor: "pointer", opacity: 1, fontWeight: 700 }}
        >
          自己提问
        </button>
      </div>
    );
  }

  let statusLine;
  if (qa.loading) statusLine = <span style={{ color: theme.solid }}>AI 正在对照原文作答…</span>;
  else if (qa.error) {
    statusLine = (
      <span style={{ color: "#E11D48" }}>
        {qa.error}
        {lastAsk ? <button type="button" data-testid="qa-retry" onClick={() => send(lastAsk.question, lastAsk.opts)} style={{ marginLeft: 8, fontSize: 12, color: theme.text, background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}>重试</button> : null}
      </span>
    );
  } else if (atTurnCap) statusLine = <span>这题聊得够多了，可以去错题本练一练</span>;
  else if (atDailyCap) statusLine = <span>今天的追问已经很多了，明天再继续吧；写作批改不受影响</span>;
  else statusLine = <span>{`还可以追问 ${qa.remaining} 次`}</span>;

  return (
    <div
      data-testid="qa-panel"
      style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: theme.cardBg, border: `1px solid ${theme.cardBd}`, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: theme.text, letterSpacing: "0.04em" }}>{firstExplain || qa.turns.length ? "继续追问" : "问这道题"}</span>
        <button type="button" onClick={() => setExpanded(false)} style={{ border: "none", background: "none", color: "#94a39a", fontSize: 11, cursor: "pointer" }}>收起</button>
      </div>

      {qa.turns.map((t, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ alignSelf: "flex-end", maxWidth: "85%", minWidth: 0, background: "#F3F4F6", color: "#111827", borderRadius: 10, padding: "6px 10px", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {/* 旧存档里「选中原文再问」的轮次照常显示选区；新提问不再带选区（改走原文批注） */}
            {t.selection?.text ? <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>{`选中："${t.selection.text.length > 80 ? `${t.selection.text.slice(0, 80)}…` : t.selection.text}"`}</div> : null}
            {t.label || t.q}
          </div>
          <Answer text={t.a} sentences={qa.sentences} materials={qa.materials} related={qa.related} dict={!!t.dict} mistakes={t.mistakes || 0} past={t.past || null} theme={theme} />
          {/可能有出入/.test(t.a) && reporting == null ? (
            <button type="button" onClick={() => setReporting(t.a)} style={{ alignSelf: "flex-start", fontSize: 12, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "2px 10px", cursor: "pointer" }}>上报这题</button>
          ) : null}
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`qa-preset-${p.id}`}
            disabled={disabled}
            onClick={() => onPreset(p)}
            style={{ fontSize: 12, color: theme.text, background: "#fff", border: `1px solid ${theme.bd}`, borderRadius: 999, padding: "3px 10px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", minWidth: 0 }}>
        <textarea
          ref={inputRef}
          data-testid="qa-input"
          rows={2}
          maxLength={1000}
          value={input}
          disabled={atTurnCap || atDailyCap}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            // 输入法组字时按 Enter 是确认候选词，不是发送
            if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            sendInput();
          }}
          placeholder="问这道题的任何问题，比如某句为什么这么说"
          style={{ flex: 1, minWidth: 0, resize: "vertical", fontSize: 16, lineHeight: 1.5, padding: "6px 8px", border: `1px solid ${theme.bd}`, borderRadius: 8, fontFamily: "inherit", maxHeight: 120 }}
        />
        <button
          type="button"
          data-testid="qa-send"
          disabled={disabled || !input.trim()}
          onClick={sendInput}
          style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: "#fff", background: disabled || !input.trim() ? "#9CA3AF" : theme.solid, border: "none", borderRadius: 8, padding: "8px 14px", cursor: disabled || !input.trim() ? "default" : "pointer" }}
        >
          发送
        </button>
      </div>

      <div data-testid="qa-status" style={{ fontSize: 11.5, color: MUTED }}>{statusLine}</div>

      {reporting != null ? <ReportBox detail={detail} answer={reporting} onDone={() => setReporting(null)} /> : null}

      <div style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.5 }}>
        回答只依据本题原文和你的作答；标「非本题材料」的是通用常识。
        {reporting == null ? <button type="button" data-testid="qa-report-link" onClick={() => setReporting(lastAnswer)} style={{ marginLeft: 4, fontSize: 11, color: "#9CA3AF", background: "none", border: "none", textDecoration: "underline", cursor: "pointer", padding: 0 }}>这题有问题？上报</button> : null}
      </div>
    </div>
  );
}
