"use client";
import { useEffect, useState } from "react";
import { getCard, saveWord, VOCAB_UPDATED_EVENT } from "../../lib/vocab/vocabStore";
import { lookupWord } from "../../lib/dict/lookup";
import { formVocabEntry } from "../../lib/notes/wordForms";

// 笔记回答里的词形表：一个词形一行（词形 + 词性 + 中文 + 说明，例句另起一行），每行右边「收藏」直接进单词本。
// 已在单词本里的词显示「已收藏」；收藏不改已有卡的复习进度（saveWord 只补缺的字段）。

function useSavedSet(words) {
  const key = words.join("|");
  const read = () => new Set(words.filter((w) => getCard(w)).map((w) => w.toLowerCase()));
  const [saved, setSaved] = useState(read);
  useEffect(() => {
    setSaved(read());
    const on = () => setSaved(read());
    window.addEventListener(VOCAB_UPDATED_EVENT, on);
    return () => window.removeEventListener(VOCAB_UPDATED_EVENT, on);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [saved, setSaved];
}

export function WordFormList({ forms }) {
  const [saved, setSaved] = useSavedSet(forms.map((f) => f.word));
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState(null);

  const save = async (form) => {
    const key = form.word.toLowerCase();
    if (saved.has(key) || busy) return;
    setBusy(key);
    setFailed(null);
    let dict = null;
    try {
      dict = await lookupWord(form.word);
    } catch {
      dict = null;
    }
    const card = saveWord(formVocabEntry(form, { dict }));
    setBusy(null);
    if (card) setSaved((cur) => new Set(cur).add(key));
    else setFailed(key);
  };

  return (
    <div data-testid="word-forms" style={{ margin: "4px 0 6px", border: "1px solid #F3D9A4", borderRadius: 8, background: "#FFFDF7", overflow: "hidden" }}>
      {forms.map((f, i) => {
        const key = f.word.toLowerCase();
        const isSaved = saved.has(key);
        return (
          <div
            key={key}
            data-testid="word-form-row"
            style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 10px", borderTop: i ? "1px solid #F6E7C8" : "none" }}
          >
            <div style={{ flex: 1, minWidth: 0, lineHeight: 1.6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 6 }}>
                <span style={{ fontWeight: 700, color: "#1f2937", fontSize: 13.5 }}>{f.word}</span>
                {f.pos ? <span style={{ fontSize: 11, color: "#92400E", background: "#FEF3C7", borderRadius: 4, padding: "0 5px" }}>{f.pos}</span> : null}
                {f.zh ? <span style={{ color: "#3f3a33" }}>{f.zh}</span> : null}
                {f.note ? <span style={{ fontSize: 11.5, color: "#8a7a62" }}>{f.note}</span> : null}
              </div>
              {f.example ? <div style={{ fontSize: 12, color: "#6b6357", fontStyle: "italic", wordBreak: "break-word" }}>{f.example}</div> : null}
            </div>
            <button
              type="button"
              data-testid={`word-form-save-${key}`}
              disabled={isSaved || busy === key}
              onClick={() => save(f)}
              title={isSaved ? "已在单词本里" : "收藏到单词本"}
              style={{
                flexShrink: 0, marginTop: 1, border: `1px solid ${isSaved ? "#D1FAE5" : "#F3D9A4"}`, borderRadius: 999,
                background: isSaved ? "#ECFDF5" : "#fff", color: isSaved ? "#047857" : "#B45309",
                font: "inherit", fontSize: 11.5, padding: "1px 9px", cursor: isSaved ? "default" : "pointer", whiteSpace: "nowrap",
              }}
            >
              {isSaved ? "★ 已收藏" : busy === key ? "收藏中…" : failed === key ? "重试收藏" : "☆ 收藏"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
