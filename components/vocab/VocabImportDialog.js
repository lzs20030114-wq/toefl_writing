"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseVocabularyText, normalizeVocabularyItems, enrichVocabularyItems, validateVocabularyEntry } from "../../lib/vocab/importVocabulary";
import { importWords, getVocabAccountKey } from "../../lib/vocab/vocabStore";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import { VocabTransferDialog } from "./VocabExportDialog";
import styles from "./VocabTransferDialog.module.css";

const ACCEPT = ".txt,.csv,.tsv,.xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp";
const progressLabel = (value, label) => typeof value === "object" && value ? `${label} ${value.completed || 0} / ${value.total || 0}` : String(value || label);
const canonical = (word) => String(word || "").trim().normalize("NFC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").toLowerCase();
export default function VocabImportDialog({ cards, accountKey, onClose }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState([]);
  const [images, setImages] = useState([]);
  const [source, setSource] = useState("粘贴词表");
  const [warnings, setWarnings] = useState([]);
  const [parsedCounts, setParsedCounts] = useState({ skipped: 0, duplicates: 0 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [reviewMode, setReviewMode] = useState("reading");
  const [result, setResult] = useState(null);
  const operation = useRef(0);
  const controller = useRef(null);
  const alive = useRef(true);
  const account = useRef(accountKey);
  const existing = useMemo(() => new Set(cards.map((card) => canonical(card.word))), [cards]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current += 1; controller.current?.abort(); }; }, []);
  const validOperation = (id) => alive.current && id === operation.current && account.current === getVocabAccountKey();
  const startOperation = () => {
    controller.current?.abort(); controller.current = new AbortController();
    const id = ++operation.current;
    setBusy(true); setError(""); setResult(null); setProgress("正在处理…");
    return id;
  };
  const showPreview = (data) => {
    if ((data.items || []).length > 1000) throw new Error("每次最多导入 1000 个词，请拆成多份后导入。");
    if (!(data.items || []).length && !(data.images || []).length) setError("未找到可导入的单词，请检查文件或粘贴内容。");
    setParsedCounts({ skipped: data.skipped || 0, duplicates: data.duplicates || 0 });
    setRows((data.items || []).map((item, id) => ({ ...item, id, selected: !item.uncertain && !validateVocabularyEntry(item) && !existing.has(canonical(item.word)) })));
    setWarnings(data.warnings?.length ? data.warnings : [...(data.skipped ? [`跳过 ${data.skipped} 条无效内容。`] : []), ...(data.duplicates ? [`词表内合并 ${data.duplicates} 条重复内容。`] : [])]);
  };
  const parseText = () => {
    operation.current += 1; controller.current?.abort(); setBusy(false); setProgress(""); setResult(null); setError("");
    setSource("粘贴词表"); setImages([]); setRows([]); setWarnings([]);
    try { showPreview(parseVocabularyText(text)); }
    catch (err) { setError(err.message || "无法读取词表，请检查格式。"); }
  };
  const chooseFile = async (file) => {
    if (!file) return;
    const id = startOperation();
    setSource(file.name); setRows([]); setImages([]); setWarnings([]);
    try {
      const { readVocabularyFile } = await import("../../lib/vocab/readVocabularyFile");
      const data = await readVocabularyFile(file, { onProgress: (message) => { if (validOperation(id)) setProgress(progressLabel(message, "正在读取")); } });
      if (!validOperation(id)) return;
      showPreview(data); setImages(data.images || []);
    } catch (err) { if (validOperation(id)) setError(err.message || "读取文件失败，请重试。"); }
    finally { if (validOperation(id)) { setBusy(false); setProgress(""); } }
  };
  const recognize = async () => {
    if (!getSavedCode()) { setError("图片识别需要先登录；也可以粘贴文字词表，在本机导入。"); return; }
    if (!["pro", "legacy"].includes(getSavedTier())) { setError("图片识别需要 Pro；文字和表格词表可以在本机导入。"); return; }
    const id = startOperation();
    try {
      const { extractVocabularyImages } = await import("../../lib/vocab/readVocabularyFile");
      if (!validOperation(id)) return;
      const data = await extractVocabularyImages(images, { userCode: getSavedCode(), signal: controller.current.signal });
      if (validOperation(id)) {
        const previousSelection = new Map();
        const preferred = new Map();
        rows.forEach((row) => {
          const key = canonical(row.word);
          const selected = row.selected && !validateVocabularyEntry(row) && !existing.has(key);
          previousSelection.set(key, previousSelection.get(key) || selected);
          if (!preferred.has(key) || selected) preferred.set(key, row);
        });
        // 编辑产生重复后，识图合并也保留用户选中的那条释义。
        const merged = normalizeVocabularyItems([...rows.map((row) => preferred.get(canonical(row.word))), ...(data.items || [])]);
        showPreview({ ...merged, skipped: parsedCounts.skipped + merged.skipped, duplicates: parsedCounts.duplicates + merged.duplicates, warnings: [...warnings, ...(data.warnings || []), ...merged.warnings] });
        setRows((current) => current.map((row) => ({ ...row, selected: previousSelection.has(canonical(row.word)) ? previousSelection.get(canonical(row.word)) : row.selected })));
        setImages([]);
      }
    } catch (err) { if (validOperation(id) && err.name !== "AbortError") setError(err.message || "识别失败，请重试或粘贴文字词表。"); }
    finally { if (validOperation(id)) { setBusy(false); setProgress(""); } }
  };
  // 只有已选条目占用同词名额；取消后其他候选立即恢复可选。
  const selectedIds = new Map();
  rows.forEach((row) => {
    const key = canonical(row.word);
    if (row.selected && key && !validateVocabularyEntry(row) && !existing.has(key) && !selectedIds.has(key)) selectedIds.set(key, row.id);
  });
  const candidates = rows.map((row) => {
    const key = canonical(row.word);
    const duplicate = !!key && (existing.has(key) || (selectedIds.has(key) && selectedIds.get(key) !== row.id));
    return { ...row, duplicate, existing: existing.has(key), validationError: validateVocabularyEntry(row) };
  });
  const selected = candidates.filter((row) => row.selected && !row.duplicate && !row.validationError && canonical(row.word));
  const uniqueSelection = (items) => {
    const chosen = new Set(existing);
    return items.map((row) => {
      const key = canonical(row.word);
      const selected = row.selected && !!key && !validateVocabularyEntry(row) && !chosen.has(key);
      if (selected) chosen.add(key);
      return { ...row, selected };
    });
  };
  const updateRow = (id, patch) => setRows((current) => uniqueSelection(current.map((row) => row.id === id ? { ...row, ...patch } : row)));
  const selectAll = () => setRows((current) => {
    // 保留当前选择；未选择的同词候选按行序只选第一条。
    const items = uniqueSelection(current);
    const chosen = new Set([...existing, ...items.filter((row) => row.selected).map((row) => canonical(row.word))]);
    return items.map((row) => {
      const key = canonical(row.word);
      if (row.selected || row.uncertain || !key || validateVocabularyEntry(row) || chosen.has(key)) return row;
      chosen.add(key);
      return { ...row, selected: true };
    });
  });
  const confirm = async () => {
    if (busy || !selected.length || getVocabAccountKey() !== account.current) return;
    const id = startOperation();
    try {
      const normalized = normalizeVocabularyItems(selected);
      if (normalized.skipped || normalized.duplicates || normalized.items.length !== selected.length) {
        throw new Error("选中的内容里有无效或重复单词，请检查单词栏，取消无效条目后重试。");
      }
      const entries = await enrichVocabularyItems(normalized.items, { signal: controller.current.signal,
        onProgress: (message) => { if (validOperation(id)) setProgress(progressLabel(message, "正在补全词典")); } });
      if (!validOperation(id)) return;
      const imported = importWords(entries, { expectedAccount: account.current, reviewMode, source });
      if (!validOperation(id)) return;
      if (imported.accountChanged) throw new Error("账号已切换，请在当前账号重新导入。");
      setResult({ ...imported, previewDuplicates: candidates.filter((row) => row.duplicate).length + parsedCounts.duplicates, previewSkipped: parsedCounts.skipped }); setRows([]); setImages([]);
    } catch (err) { if (validOperation(id) && err.name !== "AbortError") setError(err.message || "导入失败，请重试。"); }
    finally { if (validOperation(id)) { setBusy(false); setProgress(""); } }
  };
  return <VocabTransferDialog title="导入自己的词表" onClose={onClose} footer={<>
    <span aria-live="polite">{busy ? progress : result ? "导入完成" : `已选 ${selected.length} 个词`}</span>
    <button type="button" className={styles.secondary} onClick={onClose}>{result ? "完成" : "取消"}</button>
    {!result && <button type="button" className={styles.primary} disabled={busy || !selected.length} onClick={confirm}>{busy ? "正在处理…" : `确认导入 ${selected.length} 个词`}</button>}
  </>}>
    {result ? <div className={styles.success} role="status"><strong>{result.persisted ? `已保存 ${result.added} 个新词` : `已添加 ${result.added} 个新词，但浏览器未能保存`}</strong>
      <div>跳过已有或重复词 {result.duplicates + (result.previewDuplicates || 0)} 个 · 无效内容 {result.invalid + (result.previewSkipped || 0)} 条</div>
      <div>来源：{source} · {reviewMode === "reading" ? "阅读复习" : "听力复习"}</div>
      <p>{result.persisted ? "这些词已加入复习队列，可按今天的计划开始复习。" : "刷新或关闭页面后可能丢失，请检查浏览器存储空间或权限。"}</p></div>
      : <>
        <p className={styles.hint}>文字、表格和有文字层的 PDF 在本机读取。每次最多 1000 个词；已有词会跳过，并保留原来的复习进度。</p>
        <div className={styles.sourceActions}><input type="file" aria-label="选择词表文件" accept={ACCEPT} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; chooseFile(file); }} /></div>
        <p className={styles.hint}>支持 TXT、CSV、TSV、XLSX、DOCX、PDF 和图片。独立单词请用换行或逗号分隔。</p>
        <label className={styles.field}>或粘贴词表<textarea value={text} disabled={busy} onChange={(event) => setText(event.target.value)} placeholder={'每行一个词，可附释义、音标和原句，例如：\nresilient\t有韧性的\ncuriosity\t好奇心'} /></label>
        <button type="button" className={styles.secondary} disabled={busy || !text.trim()} onClick={parseText}>预览粘贴的词表</button>
        {images.length > 0 && <div className={styles.notice}><p>文件中有 {images.length} 张图片或扫描页。点击下面的按钮，会把这些图片发送给通义千问 AI 识别；需要登录及 Pro。</p>
          <button type="button" className={styles.secondary} disabled={busy} onClick={recognize}>用 AI 识别图片</button></div>}
        {warnings.length > 0 && <div className={styles.notice}>{warnings.map((warning, index) => <div key={index}>{warning}</div>)}</div>}
        {rows.length > 0 && <>
          <div className={styles.previewTools}><strong>核对词表 · {source} · {rows.length} 个词</strong>
            <button type="button" className={styles.secondary} disabled={busy} onClick={selectAll}>全选可导入词</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: false })))}>清空选择</button></div>
          <label className={styles.field}>加入哪类复习<select value={reviewMode} disabled={busy} onChange={(event) => setReviewMode(event.target.value)}><option value="reading">阅读词 · 认得并会写</option><option value="listening">听力词 · 听懂</option></select></label>
          <p className={styles.hint}>不确定的词组或句子需逐条核对并勾选，全选不会自动选中。同词只能选一条，取消已选条目后可改选另一条；全选保留已有选择，其余同词选第一条。可编辑词、释义、音标和原句；留空的释义与音标会优先用本机词典补齐。</p>
          <div className={styles.candidates}>{candidates.map((row) => <div className={styles.candidate} key={row.id}>
            <input type="checkbox" aria-label={`导入 ${row.word || `第 ${row.id + 1} 行`}`} checked={row.selected && !row.duplicate && !row.validationError} disabled={busy || row.duplicate || !!row.validationError} onChange={(event) => updateRow(row.id, { selected: event.target.checked })} />
            <label>单词<input value={row.display || row.word || ""} disabled={busy} aria-label={`第 ${row.id + 1} 行单词`} onChange={(event) => updateRow(row.id, { word: event.target.value, display: event.target.value })} /></label>
            <label>释义<input value={row.def || ""} disabled={busy} aria-label={`第 ${row.id + 1} 行释义`} onChange={(event) => updateRow(row.id, { def: event.target.value })} /></label>
            <div className={styles.candidateDetails}><label>音标<input value={row.phonetic || ""} disabled={busy} aria-label={`第 ${row.id + 1} 行音标`} onChange={(event) => updateRow(row.id, { phonetic: event.target.value })} /></label>
              <label>原句<input value={row.sentence || ""} disabled={busy} aria-label={`第 ${row.id + 1} 行原句`} onChange={(event) => updateRow(row.id, { sentence: event.target.value })} /></label></div>
            {row.uncertain && <p className={styles.duplicate}>无法确定是词组还是句子，请核对后勾选</p>}
            {row.validationError && <p className={styles.error}>{row.validationError}</p>}
            {row.duplicate && <p className={styles.duplicate}>{row.existing ? "已在单词本里，会跳过并保留原复习进度" : "同词已有选中条目，取消那条后可选择这一条"}</p>}
          </div>)}</div>
        </>}
      </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </VocabTransferDialog>;
}
