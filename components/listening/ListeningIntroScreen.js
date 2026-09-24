"use client";

import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF", border: "#E9D5FF" };

/**
 * 听力标准模式的「准备」页：进入任务前先停一下，等用户自己点「开始」。
 *
 * 为什么需要它：LCRTask / ListeningMCQTask 一挂载就 autoPlay 第一段音频。从首页
 * 「今日任务」/ 听力任务卡直接跳进 /listening?type=xxx（标准模式）时，任务组件是随
 * 路由一起挂载的——用户还没看清页面，第一题就已经在放（甚至放完了），而标准模式
 * 每段只播一遍、作答还限时，等于白丢一题。练习模式有 TopicPicker 挡在前面（点题
 * 就是手势），标准模式此前没有任何门。
 *
 * 口语页早已用 SpeakingIntroScreen 解决了同一件事；这里是听力自己的一份（紫色主题、
 * 不朗读说明文字——听力页把注意力留给正片音频）。onStart 是真实点击手势：调用方在
 * 里面 unlock 共享的考试音频元素（iOS / 微信内置浏览器需要一次手势才允许程序化播放），
 * 然后再挂载任务组件让 autoPlay 接上。
 *
 * @param {string[]} lines — 说明文字，一行一条（空串自动过滤）。
 */
export function ListeningIntroScreen({
  title,
  section,
  qInfo,
  lines = [],
  buttonLabel = "开始",
  onStart,
  onExit,
}) {
  const shown = lines.filter(Boolean);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={title} section={section} qInfo={qInfo} onExit={onExit} />
      <PageShell narrow>
        <SurfaceCard style={{ padding: "32px 28px", textAlign: "center", marginTop: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              margin: "0 auto 20px",
              background: ACCENT.soft,
              border: `2px solid ${ACCENT.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 32 }}>🎧</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 14 }}>
            准备好了再开始
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
            {shown.map((line, i) => (
              <div key={i} style={{ fontSize: 14, color: C.t2, lineHeight: 1.7 }}>
                {line}
              </div>
            ))}
          </div>
          <Btn
            onClick={onStart}
            style={{ background: ACCENT.color, borderColor: ACCENT.color, padding: "12px 40px", fontSize: 15 }}
          >
            {buttonLabel}
          </Btn>
        </SurfaceCard>
      </PageShell>
    </div>
  );
}
