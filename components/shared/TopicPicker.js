"use client";
import React, { useState } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar } from "./ui";

export function TopicPicker({ title, section, description, items, onSelect, onExit, doneIds }) {
  const done = doneIds instanceof Set ? doneIds : new Set(doneIds || []);
  const [hoverIdx, setHoverIdx] = useState(-1);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={title} section={section} onExit={onExit} />
      <PageShell narrow>
        <SurfaceCard style={{ padding: "24px 28px", marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 20, color: C.nav }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 13, color: C.t2 }}>
            {description || "Practice 模式：无时间限制，选择任意题目开始练习。"}
          </p>
          <div style={{ marginTop: 8, fontSize: 12, color: C.t2 }}>
            共 {items.length} 题，已完成 {items.filter((it) => done.has(it.id)).length} 题
          </div>
        </SurfaceCard>

        {items.length === 0 && (
          <SurfaceCard style={{ padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: C.t2 }}>暂无可用题目。</div>
            <div style={{ marginTop: 16 }}><Btn onClick={onExit} variant="secondary">返回</Btn></div>
          </SurfaceCard>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item, i) => {
            const isDone = done.has(item.id);
            const isHover = hoverIdx === i;
            return (
              <div
                key={item.id}
                data-testid={`topic-item-${item.id}`}
                onClick={() => onSelect(item.id)}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(-1)}
                style={{
                  background: "#fff",
                  border: "1px solid " + (isDone ? "#c6f6d5" : C.bdr),
                  borderLeft: "4px solid " + (isDone ? C.green : C.blue),
                  borderRadius: 6,
                  padding: "14px 18px",
                  cursor: "pointer",
                  transition: "box-shadow 0.15s, transform 0.15s",
                  boxShadow: isHover ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
                  transform: isHover ? "translateY(-1px)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: C.t2, fontWeight: 600, minWidth: 24 }}>#{i + 1}</span>
                  {item.tag && (
                    <span style={{ fontSize: 11, background: C.ltB, color: C.blue, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{item.tag}</span>
                  )}
                  {isDone && (
                    <span style={{ fontSize: 11, background: "#dcfce7", color: C.green, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>已完成</span>
                  )}
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.t1 }}>{item.title}</span>
                </div>
                {item.subtitle && (
                  <div style={{ fontSize: 12, color: C.t2, marginTop: 6, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {item.subtitle}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PageShell>
    </div>
  );
}
