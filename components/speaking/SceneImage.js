"use client";

import { useState } from "react";
import { C } from "../shared/ui";

/**
 * 复述题（Listen & Repeat）的场景插图 —— 真考里一套 N 句共用一张图常驻屏幕。
 *
 * frame = { url, w?, h? }：底图或某一句的高亮帧（挑哪一张见 RepeatTask 的 pickSceneFrame）。
 * 没图 / 加载失败一律返回 null —— 宁可不显示，也不给用户留一个破图标。
 *
 * 手机端占满宽度、高度自适应；桌面端限宽居中。带得到原始宽高时一并写上 width/height 与
 * aspectRatio，让浏览器提前留出位置，图到位时不跳版。
 */
export function SceneImage({ frame, marginBottom = 20 }) {
  const [broken, setBroken] = useState(false);
  if (!frame || !frame.url || broken) return null;
  const { url, w, h } = frame;
  const sized = Number(w) > 0 && Number(h) > 0;
  // 竖版图（平面图类接近 4:5）按满宽铺会有 500px+ 高，把听/录音控件顶出首屏。
  // 限高靠收窄 maxWidth 实现（高度仍由 aspectRatio 推出），不裁图、不变形。
  const maxWidth = sized
    ? `min(420px, calc(min(42vh, 360px) * ${(w / h).toFixed(4)}))`
    : 420;
  return (
    <div style={{ marginBottom }}>
      <img
        src={url}
        alt="场景图"
        data-testid="repeat-scene-image"
        {...(sized ? { width: w, height: h } : {})}
        onError={() => setBroken(true)}
        style={{
          display: "block", width: "100%", maxWidth, height: "auto",
          margin: "0 auto", borderRadius: 12, border: `1px solid ${C.bdr}`,
          ...(sized ? { aspectRatio: `${w} / ${h}` } : {}),
        }}
      />
    </div>
  );
}

export default SceneImage;
