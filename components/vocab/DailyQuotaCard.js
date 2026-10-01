"use client";
import { useEffect, useState } from "react";
import { HomeCollapse } from "../home/HomeCollapse";
import styles from "./VocabNotebook.module.css";

const PRESETS = [
  { label: "轻量", value: 10 },
  { label: "标准·推荐", value: 20 },
  { label: "加强", value: 30 },
];
function validNumber(value, max) {
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
}

/** open / onOpenChange 可选：概览页的「调整额度 ›」要能从外面把这张卡展开。 */
export default function DailyQuotaCard({ limits, setLimits, open: controlledOpen, onOpenChange }) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (value) => {
    const next = typeof value === "function" ? value(open) : value;
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [newDraft, setNewDraft] = useState(String(limits.newPerDay));
  const [reviewDraft, setReviewDraft] = useState(String(limits.maxReviews));
  const [error, setError] = useState("");
  useEffect(() => {
    setNewDraft(String(limits.newPerDay));
    setReviewDraft(String(limits.maxReviews));
  }, [limits.newPerDay, limits.maxReviews]);
  const choosePreset = (value) => {
    setError("");
    setLimits({ newPerDay: value });
    setNewDraft(String(value));
  };
  const save = (event) => {
    event.preventDefault();
    const newPerDay = validNumber(newDraft, 100);
    const maxReviews = validNumber(reviewDraft, 500);
    if (newPerDay === null || maxReviews === null) {
      setError("请输入整数：新词 0–100，复习上限 0–500。");
      return;
    }
    setLimits({ newPerDay, maxReviews });
    setError("");
    setOpen(false);
  };
  const cancel = () => {
    setNewDraft(String(limits.newPerDay));
    setReviewDraft(String(limits.maxReviews));
    setError("");
    setOpen(false);
  };
  return <section className={styles.card}>
    <button className={styles.quotaHeader} type="button" aria-expanded={open} aria-controls="vn-quota-content"
      onClick={() => setOpen((value) => !value)}>
      <span><strong>每日配额</strong><small>新词 {limits.newPerDay} · 到期复习 {limits.maxReviews === 0 ? "不限" : limits.maxReviews}</small></span>
      <span className={styles.chevron} aria-hidden="true">{open ? "⌃" : "⌄"}</span>
    </button>
    <HomeCollapse open={open} id="vn-quota-content" label="每日配额设置">
      <div className={styles.quotaBody}>
        <p>每日新词推荐量</p>
        <div className={styles.presets} role="group" aria-label="每日新词推荐量">
          {PRESETS.map(({ label, value }) => <button type="button" key={value}
            aria-pressed={limits.newPerDay === value} onClick={() => choosePreset(value)}>{label} {value}</button>)}
        </div>
        <p className={styles.quotaHint}>可按学习时间调整；推荐量只修改每日新词。</p>
        <form onSubmit={save}>
          <label>每天放出新词<input type="number" min="0" max="100" step="1" inputMode="numeric"
            value={newDraft} onChange={(event) => setNewDraft(event.target.value)} /></label>
          <label>每天到期词额度<input type="number" min="0" max="500" step="1" inputMode="numeric"
            value={reviewDraft} onChange={(event) => setReviewDraft(event.target.value)} /></label>
          <p className={styles.quotaHint}>阅读、听力共用额度；同一词当天只占一次。新词和当天的学习步另算。设为 0 表示不限，超额到期词顺延。</p>
          {error && <p className={styles.quotaError} role="alert">{error}</p>}
          <div className={styles.quotaActions}><button type="button" onClick={cancel}>取消</button><button type="submit">保存</button></div>
        </form>
      </div>
    </HomeCollapse>
  </section>;
}
