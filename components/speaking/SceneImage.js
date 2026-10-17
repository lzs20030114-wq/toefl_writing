"use client";

import { useState } from "react";
import { C } from "../shared/ui";
import { validSceneOverlay } from "../../lib/speakingGen/sceneAssists";

/**
 * 复述题（Listen & Repeat）的场景插图 —— 真考里一套 N 句共用一张图常驻屏幕。
 *
 * frame = { url, w?, h? }：底图或某一句的高亮帧（挑哪一张见 RepeatTask 的 pickSceneFrame）。
 * 没图 / 加载失败一律返回 null —— 宁可不显示，也不给用户留一个破图标。
 *
 * 手机端占满宽度、高度自适应；桌面端限宽居中。带得到原始宽高时一并写上 width/height 与
 * aspectRatio，让浏览器提前留出位置，图到位时不跳版。
 */
// ets：真题模考外观 —— 照真考截图，图更大（约半屏高）、方角无描边。
export function SceneImage({ frame, marginBottom = 20, ets = false }) {
  const [broken, setBroken] = useState(false);
  if (!frame || !frame.url || broken) return null;
  const { url, w, h } = frame;
  const sized = Number(w) > 0 && Number(h) > 0;
  // 竖版图（平面图类接近 4:5）按满宽铺会有 500px+ 高，把听/录音控件顶出首屏。
  // 限高靠收窄 maxWidth 实现（高度仍由 aspectRatio 推出），不裁图、不变形。
  const maxWidth = sized
    ? (ets ? `min(560px, calc(min(52vh, 440px) * ${(w / h).toFixed(4)}))` : `min(420px, calc(min(42vh, 360px) * ${(w / h).toFixed(4)}))`)
    : (ets ? 560 : 420);
  // Auxiliary drawings never enter ETS presentation, even when called directly.
  if (ets && frame.auxiliary) return null;
  const auxiliary = frame.auxiliary === true;
  const image = (
      <img
        src={url}
        alt="场景图"
        data-testid="repeat-scene-image"
        {...(sized ? { width: w, height: h } : {})}
        onError={() => setBroken(true)}
        style={{ display: "block", width: "100%", maxWidth, height: "auto",
          margin: "0 auto", borderRadius: ets ? 0 : 12, border: ets ? "none" : `1px solid ${C.bdr}`,
          ...(sized ? { aspectRatio: `${w} / ${h}` } : {}) }}
      />
  );
  return (
    <div style={{ marginBottom }}>
      {auxiliary ? <>
        <div style={{ position: "relative", width: "100%", maxWidth, margin: "0 auto" }}>
          {image}
          {sized && Array.isArray(frame.overlay) && <svg data-testid="scene-assist-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {frame.overlay.filter(validSceneOverlay).map((shape, index) => {
              const props = { fill: "rgba(245,158,11,0.16)", stroke: "#F59E0B", strokeWidth: 3, vectorEffect: "non-scaling-stroke" };
              if (shape.type === "rect") return <rect key={index} {...props} x={shape.x * 1000} y={shape.y * 1000} width={shape.width * 1000} height={shape.height * 1000} />;
              if (shape.type === "ellipse") return <ellipse key={index} {...props} cx={shape.cx * 1000} cy={shape.cy * 1000} rx={shape.rx * 1000} ry={shape.ry * 1000} />;
              return <polygon key={index} {...props} points={shape.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} />;
            })}
          </svg>}
        </div>
        <div data-testid="scene-assist-label" style={{ textAlign: "center", fontSize: 12, color: C.t2, marginTop: 6 }}>{frame.kind === "redraw" ? "辅助重绘图" : "辅助高亮"}</div>
      </> : image}
    </div>
  );
}

export default SceneImage;
