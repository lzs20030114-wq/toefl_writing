"use client";
import { useCallback, useRef, useState } from "react";
import { C } from "./ui";
import { canSpeak, speakWord } from "../../lib/audio/speakWord";

/**
 * 「念一下这个词」的小圆钮。划词词典弹窗、单词本列表、复习卡共用一个。
 *
 * 浏览器没有语音合成（部分 WebView）时整颗不渲染 —— 给一个按不响的钮比没有更糟。
 * 点击一律 stopPropagation：这颗钮常常坐在「点一下就翻面 / 就展开」的行里面。
 */
export function SpeakButton({ word, size = 28, palette, style, title = "朗读这个词" }) {
  const [speaking, setSpeaking] = useState(false);
  // 第几次朗读：被下一次掐掉的那次，它的回调不该回来把新的一次关掉。
  const tokenRef = useRef(0);

  const play = useCallback(
    (e) => {
      if (e) e.stopPropagation();
      if (!word) return;
      const token = (tokenRef.current += 1);
      const stop = () => {
        if (tokenRef.current === token) setSpeaking(false);
      };
      setSpeaking(true);
      if (!speakWord(word, { onDone: stop })) stop();
    },
    [word]
  );

  if (!word || !canSpeak()) return null;

  const idle = (palette && palette.border) || C.bdr;
  const on = (palette && palette.activeBorder) || "#9ed3b8";
  const onBg = (palette && palette.activeBg) || "#e8f5ee";

  return (
    <button
      onClick={play}
      aria-label={title}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        padding: 0,
        border: `1px solid ${speaking ? on : idle}`,
        background: speaking ? onBg : "#fff",
        color: C.t2,
        borderRadius: 999,
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        cursor: "pointer",
        ...style,
      }}
    >
      🔊
    </button>
  );
}
