"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_FONT } from "../home/theme";
import { getVocabAccountKey } from "../../lib/vocab/vocabStore";
import { humanizeDef } from "../../lib/dict/core";
import styles from "./VocabTransferDialog.module.css";

// 两个词库工具复用同一份键盘与滚动行为，页面外壳继续由首页负责。
export function VocabTransferDialog({ title, onClose, children, footer }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.querySelector("button, input, textarea, select")?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []);
      if (!controls.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className={styles.overlay} style={{ fontFamily: HOME_FONT }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.dialog} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className={styles.header}><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭窗口" onClick={onClose}>×</button></header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  </div>, document.body);
}

export default function VocabExportDialog({ cards, accountKey, onClose }) {
  const [title, setTitle] = useState("我的单词复习表");
  const [includeSentences, setIncludeSentences] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const latestCards = useRef(cards);
  latestCards.current = cards;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const download = async () => {
    if (busy || !cards.length || getVocabAccountKey() !== accountKey) return;
    setBusy(true); setError("");
    try {
      const { createVocabularyPdf, vocabularyPdfFilename } = await import("../../lib/vocab/exportVocabularyPdf");
      const sourceCards = latestCards.current;
      const date = new Date();
      const bytes = await createVocabularyPdf(sourceCards, { title: title.trim() || "我的单词复习表", includeSentences, date });
      if (!alive.current || accountKey !== getVocabAccountKey()) return;
      // 生成期间删除或取消选中的词，不下载旧快照。
      if (sourceCards.length !== latestCards.current.length || sourceCards.some((card, i) => card.word !== latestCards.current[i]?.word)) {
        setError("选中的词已变化，请重新下载。"); return;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url; link.download = vocabularyPdfFilename(title.trim() || "我的单词复习表", date);
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) { if (alive.current) setError(err.message || "PDF 生成失败，请重试。"); }
    finally { if (alive.current) setBusy(false); }
  };
  return <VocabTransferDialog title="导出单词 PDF" onClose={onClose} footer={<>
    <span aria-live="polite">已选择 {cards.length} 个词</span>
    <button type="button" className={styles.secondary} onClick={onClose}>取消</button>
    <button type="button" className={styles.primary} disabled={busy || !cards.length} onClick={download}>{busy ? "正在生成…" : "下载 PDF"}</button>
  </>}>
    <p className={styles.hint}>A4 复习表，按当前选择的词生成，适合打印和遮住释义自测。</p>
    <label className={styles.field}>标题<input value={title} disabled={busy} maxLength={100} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className={styles.check}><input type="checkbox" checked={includeSentences} disabled={busy} onChange={(event) => setIncludeSentences(event.target.checked)} />包含已保存的原句</label>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.preview} aria-label="PDF 模板预览">
      <small className={styles.brand}>TREEPRACTICE · VOCABULARY</small>
      <h3>{title.trim() || "我的单词复习表"}</h3>
      <p>{new Date().toLocaleDateString("zh-CN")} · {cards.length} 个词</p>
      <div className={styles.previewHead}><span>自测</span><span>单词 · 音标</span><span>中文释义</span></div>
      {cards.slice(0, 3).map((card) => <div className={styles.previewRow} key={card.word}>
        <span aria-hidden="true">□</span><div><strong>{card.display || card.word}</strong>{card.phonetic && <small>/{card.phonetic}/</small>}</div>
        <div>{card.def || card.defFull ? humanizeDef(card.def || card.defFull) : "暂无释义"}</div>
        {includeSentences && card.sentence && <p className={styles.previewSentence}>原句　{card.sentence}</p>}
      </div>)}
      <p className={styles.previewNote}>此处展示前 {Math.min(3, cards.length)} 个词；PDF 包含全部已选词并自动分页。</p>
    </div>
  </VocabTransferDialog>;
}
