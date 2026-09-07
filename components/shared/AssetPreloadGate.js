"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { C, FONT, TopBar } from "./ui";

/**
 * 题目素材预加载门：先把题目要用到的图片全部拉下来，再渲染真正的做题界面。
 *
 * 为什么要这一层：RDLTask / CTWTask 一挂载就起计时器（倒计时或用时），而真题阅读的
 * 「材料框原图」走 /api/img 代理，国内用户常要等一两秒 —— 用户看到的是计时已经在跑、
 * 材料还是一片空白。把 <img> 的下载提前到这里，子组件挂载时同一 URL 直接命中浏览器缓存
 * （/api/img 打了 immutable 一年缓存），计时从「看到题」那一刻开始。
 *
 * 契约：
 *   - images 为空 → 原样返回 children，不多套任何 DOM（老库 / 个人题库零变化）；
 *   - 每张图 load 或 error 都算「结束」——图坏了也放行，RDLTask 自带「切换为文字」兜底；
 *   - 超过 timeoutMs（默认 15s）强制放行，不许把用户永远锁在加载页；
 *   - images 变化（换题）自动重来一轮。
 */
export const PRELOAD_TIMEOUT_MS = 15000;

function uniqueUrls(images) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(images) ? images : []) {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function AssetPreloadGate({
  images,
  children,
  title = "",
  section = "",
  onExit,
  timeoutMs = PRELOAD_TIMEOUT_MS,
}) {
  const signature = uniqueUrls(images).join("\n");
  const urls = useMemo(() => (signature ? signature.split("\n") : []), [signature]);

  // settled: 已经 load / error 的 URL；换题（signature 变）时整体重置。
  const [progress, setProgress] = useState({ signature, settled: [], timedOut: false });
  const current = progress.signature === signature
    ? progress
    : { signature, settled: [], timedOut: false };

  const ready = urls.length === 0
    || current.timedOut
    || urls.every((u) => current.settled.includes(u));

  const markSettled = (url) => {
    setProgress((prev) => {
      const base = prev.signature === signature ? prev : { signature, settled: [], timedOut: false };
      if (base.settled.includes(url)) return base;
      return { ...base, settled: [...base.settled, url] };
    });
  };

  // 超时兜底：只在还没就绪时挂计时器，签名变化时重挂。
  const timerRef = useRef(null);
  useEffect(() => {
    if (ready) return undefined;
    timerRef.current = setTimeout(() => {
      setProgress((prev) => (prev.signature === signature
        ? { ...prev, timedOut: true }
        : { signature, settled: [], timedOut: true }));
    }, timeoutMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [ready, signature, timeoutMs]);

  if (ready) return <>{children}</>;

  const loadedCount = urls.filter((u) => current.settled.includes(u)).length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={title} section={section} onExit={onExit} />
      <div
        role="status"
        aria-live="polite"
        data-testid="asset-preload-gate"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: "calc(100vh - 56px)", padding: 24,
        }}
      >
        <div style={{
          background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 16,
          boxShadow: C.shadow, padding: "36px 40px", textAlign: "center", maxWidth: 360, width: "100%",
        }}>
          <div style={{
            width: 36, height: 36, margin: "0 auto 18px", borderRadius: "50%",
            border: `3px solid ${C.bdrSubtle}`, borderTopColor: C.blue,
            animation: "tp-preload-spin 0.8s linear infinite",
          }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 6 }}>正在加载题目材料</div>
          <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>
            图片就绪后自动进入题目，计时从进入后才开始。
          </div>
          <div
            data-testid="asset-preload-progress"
            style={{ marginTop: 14, fontSize: 12.5, color: C.t3, fontFamily: "Consolas, Menlo, 'Courier New', monospace" }}
          >
            {loadedCount} / {urls.length}
          </div>
        </div>
        {/* 隐藏的真实 <img>：同一 URL 会进浏览器缓存，子组件里的 <img> 直接复用。 */}
        <div aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
          {urls.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              data-testid="asset-preload-img"
              onLoad={() => markSettled(url)}
              onError={() => markSettled(url)}
              ref={(el) => {
                // 缓存命中时 load 事件可能在 React 绑定监听之前就已触发。
                if (el && el.complete && el.naturalWidth > 0) markSettled(url);
              }}
            />
          ))}
        </div>
        <style dangerouslySetInnerHTML={{ __html: "@keyframes tp-preload-spin{to{transform:rotate(360deg)}}" }} />
      </div>
    </div>
  );
}

export default AssetPreloadGate;
