"use client";
import { useEffect, useRef, useState } from "react";
import { getCard, getVocabAccountKey, saveWord, saveWordGroup, VOCAB_UPDATED_EVENT } from "../../lib/vocab/vocabStore";
import { AUTH_CHANGED_EVENT } from "../../lib/AuthContext";
import { lookupWord } from "../../lib/dict/lookup";
import { familyHead, formVocabEntry } from "../../lib/notes/wordForms";

// 笔记回答里的词形表：一个词形一行（词形 + 词性 + 中文 + 说明，例句另起一行），每行右边「收藏」直接进单词本。
// 已在单词本里的词显示「已收藏」；收藏不改已有卡的复习进度（saveWord 只补缺的字段）。
// 表头「整组收藏」把整张表收进单词本并归成一个词形组（组名 = 问的那个词），复习时同组词连着出现；
// 单个点收藏的新词也进这组。从别处收藏过、已在别的组的词，只有点「整组收藏」才会被归进来。

function currentCard(word) {
  return getCard(word, getVocabAccountKey());
}

function subscribeChanges(on) {
  window.addEventListener(VOCAB_UPDATED_EVENT, on);
  window.addEventListener(AUTH_CHANGED_EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(VOCAB_UPDATED_EVENT, on);
    window.removeEventListener(AUTH_CHANGED_EVENT, on);
    window.removeEventListener("storage", on);
  };
}

function useSavedSet(words) {
  const key = words.join("|");
  const read = () => new Set(words.filter((w) => currentCard(w)).map((w) => w.toLowerCase()));
  const [saved, setSaved] = useState(read);
  useEffect(() => {
    setSaved(read());
    const on = () => setSaved(read());
    return subscribeChanges(on);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [saved, setSaved];
}

/** 这张表里的词是不是都已收藏、且都在 family 这一组。 */
function useGrouped(words, family) {
  const key = `${family}|${words.join("|")}`;
  const read = () => !!family && words.every((w) => currentCard(w)?.family === family);
  const [grouped, setGrouped] = useState(read);
  useEffect(() => {
    setGrouped(read());
    const on = () => setGrouped(read());
    return subscribeChanges(on);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return grouped;
}

async function dictOf(word) {
  try {
    return await lookupWord(word);
  } catch {
    return null;
  }
}

export function WordFormList({ forms, quote = "", grouping = false }) {
  const words = forms.map((f) => f.word);
  // 只有词形表成组；搭配表（同一组件渲染）不成组。
  const family = grouping ? familyHead(forms, quote) : "";
  const [saved, setSaved] = useSavedSet(words);
  const grouped = useGrouped(words, family);
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState(null);
  const operation = useRef(null);

  useEffect(() => {
    const cancelStale = (event) => {
      const pending = operation.current;
      if (!pending) return;
      // Check the event too: another tab may have switched A → B → A before
      // this tab receives its queued storage events.
      const identityChanged = event.type === "storage" &&
        (!event.storageArea || event.storageArea === localStorage) &&
        (event.key === null || (event.key === "toefl-user-code" && event.oldValue !== event.newValue));
      if (identityChanged || pending.account !== getVocabAccountKey()) {
        operation.current = null;
        setBusy(null);
        setFailed(null);
      }
    };
    const unsubscribe = subscribeChanges(cancelStale);
    return () => { operation.current = null; unsubscribe(); };
  }, []);

  const begin = (key) => {
    const pending = { account: getVocabAccountKey() };
    operation.current = pending;
    setBusy(key);
    setFailed(null);
    return pending;
  };
  const isCurrent = pending => operation.current === pending && pending.account === getVocabAccountKey();
  const finish = pending => {
    if (operation.current !== pending) return;
    operation.current = null;
    setBusy(null);
  };

  const save = async (form) => {
    const key = form.word.toLowerCase();
    if (saved.has(key) || operation.current) return;
    const pending = begin(key);
    try {
      const dict = await dictOf(form.word);
      if (!isCurrent(pending)) return;
      const card = saveWord(formVocabEntry(form, { dict, family }), new Date(), pending.account);
      if (!isCurrent(pending)) return;
      if (card) setSaved((cur) => new Set(cur).add(key));
      else setFailed(key);
    } catch {
      if (isCurrent(pending)) setFailed(key);
    } finally { finish(pending); }
  };

  const saveGroup = async () => {
    if (operation.current || grouped || !family) return;
    const pending = begin("__group");
    try {
      const missing = forms.filter((f) => !getCard(f.word, pending.account));
      const dicts = await Promise.all(missing.map((f) => dictOf(f.word)));
      if (!isCurrent(pending)) return;
      const entries = missing.map((f, i) => formVocabEntry(f, { dict: dicts[i], family }));
      const cards = saveWordGroup(entries, words, family, new Date(), pending.account);
      if (!isCurrent(pending)) return;
      setSaved(new Set(words.filter((w) => currentCard(w)).map((w) => w.toLowerCase())));
      if (!cards) setFailed("__group");
    } catch {
      if (isCurrent(pending)) setFailed("__group");
    } finally { finish(pending); }
  };

  return (
    <div data-testid="word-forms" style={{ margin: "4px 0 6px", border: "1px solid #F3D9A4", borderRadius: 8, background: "#FFFDF7", overflow: "hidden" }}>
      {forms.length > 1 && family ? (
        <div
          data-testid="word-forms-group"
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "#FEF7E6", borderBottom: "1px solid #F6E7C8" }}
        >
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "#8a7a62", lineHeight: 1.5 }}>
            {grouped ? `已成「${family}」组，复习时这些词连着出现` : "整组收进单词本，复习时这些词连着出现"}
          </span>
          <button
            type="button"
            data-testid="word-forms-save-group"
            disabled={grouped || !!busy}
            onClick={saveGroup}
            style={{
              flexShrink: 0, border: `1px solid ${grouped ? "#D1FAE5" : "#F59E0B"}`, borderRadius: 999,
              background: grouped ? "#ECFDF5" : "#F59E0B", color: grouped ? "#047857" : "#fff", fontWeight: 600,
              font: "inherit", fontSize: 11.5, padding: "1px 10px", cursor: grouped ? "default" : "pointer", whiteSpace: "nowrap",
            }}
          >
            {grouped ? "✓ 已成组" : busy === "__group" ? "收藏中…" : failed === "__group" ? "重试整组收藏" : `整组收藏（${forms.length} 个）`}
          </button>
        </div>
      ) : null}
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
