"use client";
import React, { useMemo, useState } from "react";
import { WordLookupLayer } from "../reading/WordLookupLayer";
import { usePassageNotes } from "./usePassageNotes";
import { paragraphSpans, highlightSegments, notesByParagraph, NOTE_MAX_TURNS, NOTE_MAX_QUESTION } from "../../lib/notes/passageNotes";
import { parseAnswer, sentenceLabel } from "../../lib/qa/questionQa";
import { tidyNoteSegments } from "../../lib/notes/noteQa";

// 带原文批注的文章：划词词典 + 选中提问，问过的地方留高亮和序号，点一下展开笔记卡（默认收起）。
// 用法：<NotedPassage passage={passage} style={…} />，原样替换「<WordLookupLayer passage>{passage}</WordLookupLayer>」。
// paragraphWrap(i, para, content) 可选：自定义每段外壳（例如前面加段号）；不传就是一段一个 pre-wrap 的 div。

const AMBER = "#B45309";

// 选中效果和批注高亮同一套琥珀色：拖选时（::selection）和松手后弹窗开着时（::highlight，
// WordLookupLayer 把浏览器选区换成的那段高亮）看着是一回事。笔记卡里不改，保持系统默认。
const SELECTION_CSS = `
[data-noted-passage] ::selection { background: rgba(251, 191, 36, 0.38); color: inherit; }
[data-noted-passage] [data-note-card] ::selection { background: Highlight; color: HighlightText; }
::highlight(note-pending) { background-color: rgba(251, 191, 36, 0.45); text-decoration: underline 2px #F59E0B; text-underline-offset: 3px; }
`;

function hasSelection() {
  // 在高亮里拖选文字也会触发 click：有选区时不当成「点开笔记」。
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  return !!(sel && !sel.isCollapsed && sel.toString().trim());
}

function CiteTag({ ok, children, title }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block", margin: "0 2px", padding: "0 5px", borderRadius: 4, fontSize: 10.5, lineHeight: "16px",
        verticalAlign: "1px", background: ok ? "#FEF3C7" : "#F3F4F6", color: ok ? "#92400E" : "#9CA3AF", fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function NoteAnswer({ text, sentences, dict }) {
  const segments = useMemo(
    () => tidyNoteSegments(parseAnswer(text, sentences, [], { dict: !!dict }), sentences, (s) => sentenceLabel(s, sentences)),
    [text, sentences, dict],
  );
  const byId = useMemo(() => new Map(sentences.map((s) => [s.id, s])), [sentences]);
  const bad = segments.filter((s) => (s.type === "cite" || s.type === "quote") && !s.valid).length;
  return (
    <div>
      <div data-testid="note-answer" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#3f3a33", lineHeight: 1.8 }}>
        {segments.map((s, i) => {
          if (s.type === "break") return <div key={i} style={{ height: 6 }} />;
          if (s.type === "heading") return <span key={i} style={{ fontWeight: 700, color: "#78350F", marginRight: 4 }}>{`${s.text}：`}</span>;
          if (s.type === "text") return <React.Fragment key={i}>{s.text}</React.Fragment>;
          if (s.type === "quote") {
            return s.valid
              ? <React.Fragment key={i}>{s.text}</React.Fragment>
              : <span key={i} title="这段引文在原文里找不到" style={{ textDecoration: "underline dashed #D97706", textUnderlineOffset: 3 }}>{s.text}</span>;
          }
          if (s.kind === "sentence") {
            const sent = byId.get(s.id);
            const label = sent ? sentenceLabel(sent, sentences) : "出处";
            return <CiteTag key={i} ok={s.valid} title={s.valid ? sent?.text : "这条出处核对不上，请以原文为准"}>{s.valid ? label : `${label}?`}</CiteTag>;
          }
          const name = s.kind === "dict" ? "词典" : s.kind === "answer" ? "答案" : s.id;
          return <CiteTag key={i} ok={s.valid} title={s.valid ? undefined : "这条出处核对不上，请以原文为准"}>{s.valid ? name : `${name}?`}</CiteTag>;
        })}
      </div>
      {bad > 0 ? <div style={{ marginTop: 3, fontSize: 11, color: "#9CA3AF" }}>{`有 ${bad} 处出处或引文核对不上，已标灰，请以原文为准`}</div> : null}
    </div>
  );
}

function FollowUp({ onAsk, left }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = text.trim();
        if (!v) return;
        onAsk(v);
        setText("");
      }}
      style={{ display: "flex", gap: 6, marginTop: 8 }}
    >
      <input
        data-testid="note-follow-input"
        value={text}
        maxLength={NOTE_MAX_QUESTION}
        onChange={(e) => setText(e.target.value)}
        placeholder={`接着问这一处（还能问 ${left} 轮）`}
        style={{ flex: 1, minWidth: 0, border: "1px solid #ecdcbc", borderRadius: 6, padding: "4px 8px", font: "inherit", fontSize: 12, background: "#fff", color: "#22322a" }}
      />
      <button
        type="submit"
        data-testid="note-follow-send"
        disabled={!text.trim()}
        style={{ border: "none", borderRadius: 6, background: text.trim() ? AMBER : "#d6c7ae", color: "#fff", padding: "4px 12px", font: "inherit", fontSize: 12, fontWeight: 600, cursor: text.trim() ? "pointer" : "default" }}
      >
        问
      </button>
    </form>
  );
}

function NoteCard({ placed, notes, collapsedOnly = false }) {
  const { note, index } = placed;
  const [confirm, setConfirm] = useState(false);
  const open = notes.isOpen(note.id);
  const loading = notes.loadingId === note.id;
  const error = notes.errors[note.id];
  const turns = note.turns || [];
  const left = NOTE_MAX_TURNS - turns.length;
  const lost = placed.start == null && !note.draft;

  return (
    <div
      data-no-dict
      data-note-card
      data-testid="note-card"
      style={{
        margin: "4px 0 12px", padding: open ? "8px 12px 10px" : "4px 10px", borderLeft: "3px solid #F59E0B", background: "#FFFBEB",
        borderRadius: "0 8px 8px 0", fontSize: 12.5, lineHeight: 1.7, whiteSpace: "normal", fontStyle: "normal", fontWeight: 400,
        fontFamily: "'Plus Jakarta Sans','Noto Sans SC',sans-serif", color: "#3f3a33",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          data-testid="note-card-toggle"
          onClick={() => notes.toggle(note.id)}
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <span style={{ flexShrink: 0, minWidth: 16, height: 16, borderRadius: 8, background: "#F59E0B", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{index}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "Georgia, serif", color: "#57534e" }}>“{note.quote}”</span>
          {lost ? <span style={{ flexShrink: 0, fontSize: 11, color: "#9CA3AF" }}>原文里找不到这一处了</span> : null}
          <span style={{ flexShrink: 0, fontSize: 11, color: "#a8a29e" }}>{open ? "收起 ▴" : `${turns.length} 问 ▾`}</span>
        </button>
      </div>
      {open && !collapsedOnly ? (
        <div style={{ marginTop: 6 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ marginTop: i ? 10 : 0 }}>
              <div style={{ fontWeight: 700, color: AMBER, marginBottom: 2 }}>{`问：${t.label || t.q}`}</div>
              <NoteAnswer text={t.a} sentences={notes.sentences} dict={t.dict} />
            </div>
          ))}
          {note.draft && note.pendingQuestion ? (
            <div style={{ fontWeight: 700, color: AMBER, marginBottom: 2 }}>{`问：${note.pendingQuestion.label || note.pendingQuestion.q}`}</div>
          ) : null}
          {loading ? <div data-testid="note-loading" style={{ marginTop: 4, color: "#a8a29e" }}>AI 正在回答…</div> : null}
          {error ? (
            <div role="alert" style={{ marginTop: 4, color: "#B91C1C" }}>
              {error}
              {note.draft ? (
                <button type="button" onClick={() => notes.retryDraft()} style={{ marginLeft: 8, border: "none", background: "transparent", color: AMBER, font: "inherit", fontWeight: 600, cursor: "pointer", padding: 0 }}>重试</button>
              ) : null}
            </div>
          ) : null}
          {!note.draft && !loading && notes.isPro && left > 0 && notes.dailyLeft > 0 ? (
            <FollowUp left={left} onAsk={(q) => notes.askFollow(note.id, q)} />
          ) : null}
          {!note.draft && left <= 0 ? <div style={{ marginTop: 6, fontSize: 11, color: "#a8a29e" }}>{`这一处已经问满 ${NOTE_MAX_TURNS} 轮，换个地方选中再问`}</div> : null}
          {!loading ? (
            <div style={{ marginTop: 8, display: "flex", gap: 10, fontSize: 11.5 }}>
              {confirm ? (
                <>
                  <span style={{ color: "#78716c" }}>删除这条笔记？</span>
                  <button type="button" data-testid="note-delete-confirm" onClick={() => notes.remove(note.id)} style={{ border: "none", background: "transparent", color: "#B91C1C", font: "inherit", fontWeight: 600, cursor: "pointer", padding: 0 }}>删除</button>
                  <button type="button" onClick={() => setConfirm(false)} style={{ border: "none", background: "transparent", color: "#78716c", font: "inherit", cursor: "pointer", padding: 0 }}>取消</button>
                </>
              ) : (
                <button type="button" data-testid="note-delete" onClick={() => (note.draft ? notes.remove(note.id) : setConfirm(true))} style={{ border: "none", background: "transparent", color: "#a8a29e", font: "inherit", cursor: "pointer", padding: 0 }}>
                  {note.draft ? "不问了" : "删除笔记"}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function NotedPassage({ passage, style, source = "reading", paragraphWrap, paraGap = "0.9em" }) {
  const notes = usePassageNotes(passage, { source });
  const paras = useMemo(() => paragraphSpans(passage), [passage]);
  const byPara = useMemo(() => notesByParagraph(paras, notes.placed), [paras, notes.placed]);
  const idOf = useMemo(() => new Map(notes.placed.map((p) => [p.index, p.note.id])), [notes.placed]);

  const toggleIndex = (index) => {
    const id = idOf.get(index);
    if (id) notes.toggle(id);
  };

  return (
    <WordLookupLayer passage={passage} style={style} source={source} notes={notes}>
      <style dangerouslySetInnerHTML={{ __html: SELECTION_CSS }} />
      <div data-noted-passage>
      {paras.length === 0 ? passage : null}
      {paras.map((para, i) => {
        const segs = highlightSegments(para.text, para.start, notes.placed);
        const content = segs.map((seg, k) => {
          if (!seg.marks.length) return <React.Fragment key={k}>{seg.text}</React.Fragment>;
          const top = seg.marks[seg.marks.length - 1];
          const open = seg.marks.some((m) => notes.isOpen(idOf.get(m)));
          return (
            <React.Fragment key={k}>
              <mark
                data-note-mark={top}
                data-testid="note-mark"
                onClick={() => { if (!hasSelection()) toggleIndex(top); }}
                style={{ background: open ? "#FDE68A" : "#FEF3C7", color: "inherit", padding: 0, borderBottom: "2px solid #F59E0B", cursor: "pointer", borderRadius: 2 }}
              >
                {seg.text}
              </mark>
              {seg.endsNote.map((n) => (
                <sup
                  key={`b${n}`}
                  data-no-dict
                  data-testid="note-badge"
                  role="button"
                  aria-label={`笔记 ${n}`}
                  onClick={() => toggleIndex(n)}
                  style={{ fontSize: 9.5, fontWeight: 700, color: "#B45309", cursor: "pointer", marginLeft: 1, fontFamily: "'Plus Jakarta Sans',sans-serif", fontStyle: "normal" }}
                >
                  {n}
                </sup>
              ))}
            </React.Fragment>
          );
        });
        const cards = (byPara.get(i) || []).filter((p) => p.start == null || notes.isOpen(p.note.id));
        const body = paragraphWrap
          ? paragraphWrap(i, para, content)
          : <div style={{ whiteSpace: "pre-wrap", marginBottom: i < paras.length - 1 ? paraGap : 0 }}>{content}</div>;
        return (
          <React.Fragment key={i}>
            {body}
            {cards.map((p) => <NoteCard key={p.note.id} placed={p} notes={notes} />)}
          </React.Fragment>
        );
      })}
      </div>
    </WordLookupLayer>
  );
}
