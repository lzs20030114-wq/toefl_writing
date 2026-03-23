"use client";
import React, { useMemo, useState } from "react";
import { C, FONT, Btn, TopBar } from "./ui";
import { HOME_TOKENS as T, HOME_FONT, HOME_PAGE_CSS } from "../home/theme";

function Arrow({ color }) {
  return <div style={{ color, fontSize: 15, lineHeight: 1 }}>&gt;</div>;
}

export function TopicPicker({ title, section, description, items, onSelect, onExit, doneIds, accent }) {
  const done = doneIds instanceof Set ? doneIds : new Set(doneIds || []);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [activeCategory, setActiveCategory] = useState(null);
  const [catHover, setCatHover] = useState(null);

  const ac = accent || { color: T.primary, soft: T.primarySoft };
  const doneCount = items.filter((it) => done.has(it.id)).length;
  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  // Build category list from item tags (only show filter when > 8 items and > 2 categories)
  const categories = useMemo(() => {
    const map = new Map();
    items.forEach((it) => {
      const cat = it.tag || "";
      if (cat) map.set(cat, (map.get(cat) || 0) + 1);
    });
    if (map.size <= 2 || items.length <= 8) return null;
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [items]);

  const filtered = activeCategory
    ? items.filter((it) => it.tag === activeCategory)
    : items;

  return (
    <>
      <style>{HOME_PAGE_CSS}{`
@media (max-width: 960px) {
  .topic-grid { grid-template-columns: 1fr !important; }
  .topic-shell { padding: 20px 16px 48px !important; }
  .topic-cats { justify-content: flex-start; }
}
`}</style>
      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: HOME_FONT }}>
        <TopBar title={title} section={section} onExit={onExit} />

        <div className="topic-shell" style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 36px 60px" }}>
          {/* Header card */}
          <div style={{
            background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14,
            boxShadow: T.shadow, padding: "24px 28px", marginBottom: 20,
            animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 50ms both",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, color: ac.color, fontWeight: 700, letterSpacing: 0.3, marginBottom: 4 }}>Practice Mode</div>
                <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: T.t1, letterSpacing: -0.3 }}>{title}</h2>
                <p style={{ margin: 0, fontSize: 13, color: T.t2, lineHeight: 1.5 }}>
                  {description || "无时间限制，选择任意题目开始练习。"}
                </p>
              </div>
              <div style={{ textAlign: "right", minWidth: 140 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: ac.color }}>{doneCount}<span style={{ fontSize: 16, fontWeight: 600, color: T.t3 }}>/{items.length}</span></div>
                <div style={{ fontSize: 11, color: T.t3, marginBottom: 8 }}>已完成</div>
                <div style={{ height: 6, background: `${ac.color}18`, borderRadius: 3, overflow: "hidden", width: 140 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: ac.color, borderRadius: 3, transition: "width 0.3s ease" }} />
                </div>
              </div>
            </div>
          </div>

          {/* Category filter tabs */}
          {categories && (
            <div className="topic-cats" style={{
              display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, padding: "0 2px",
              animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 100ms both",
            }}>
              <button
                onClick={() => setActiveCategory(null)}
                onMouseEnter={() => setCatHover("__all__")}
                onMouseLeave={() => setCatHover(null)}
                style={{
                  border: "none", borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: HOME_FONT, transition: "all .15s",
                  background: !activeCategory ? ac.color : (catHover === "__all__" ? `${ac.color}15` : T.card),
                  color: !activeCategory ? "#fff" : T.t2,
                  boxShadow: !activeCategory ? `0 2px 8px ${ac.color}40` : T.shadow,
                }}
              >
                全部 ({items.length})
              </button>
              {categories.map((cat) => {
                const selected = activeCategory === cat.name;
                const isHover = catHover === cat.name;
                return (
                  <button
                    key={cat.name}
                    onClick={() => setActiveCategory(selected ? null : cat.name)}
                    onMouseEnter={() => setCatHover(cat.name)}
                    onMouseLeave={() => setCatHover(null)}
                    style={{
                      border: "none", borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", fontFamily: HOME_FONT, transition: "all .15s",
                      background: selected ? ac.color : (isHover ? `${ac.color}15` : T.card),
                      color: selected ? "#fff" : T.t2,
                      boxShadow: selected ? `0 2px 8px ${ac.color}40` : T.shadow,
                    }}
                  >
                    {cat.name} ({cat.count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {items.length === 0 && (
            <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: 40, textAlign: "center", boxShadow: T.shadow }}>
              <div style={{ fontSize: 14, color: T.t2, marginBottom: 16 }}>暂无可用题目。</div>
              <Btn onClick={onExit} variant="secondary">返回</Btn>
            </div>
          )}

          {/* Topic grid */}
          <div className="topic-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {filtered.map((item, i) => {
              const isDone = done.has(item.id);
              const globalIndex = items.indexOf(item);
              const isHover = hoverIdx === globalIndex;
              return (
                <div
                  key={item.id}
                  data-testid={`topic-item-${item.id}`}
                  onClick={() => onSelect(item.id)}
                  onMouseEnter={() => setHoverIdx(globalIndex)}
                  onMouseLeave={() => setHoverIdx(-1)}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    position: "relative",
                    background: T.card,
                    border: `1px solid ${isHover ? `${ac.color}90` : T.bdr}`,
                    borderRadius: 12,
                    overflow: "hidden",
                    cursor: "pointer",
                    transform: isHover ? "translateY(-2px)" : "translateY(0)",
                    boxShadow: isHover ? `0 6px 18px ${ac.color}28` : T.shadow,
                    transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
                    animation: `fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) ${150 + i * 30}ms both`,
                  }}
                >
                  {/* Left accent bar on hover */}
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: isDone ? T.primary : ac.color, opacity: isHover || isDone ? 1 : 0, transition: "opacity 150ms ease" }} />

                  {/* Number panel */}
                  <div style={{
                    width: 52, minWidth: 52, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    background: isDone ? T.primarySoft : ac.soft,
                    padding: "10px 4px",
                  }}>
                    {isDone ? (
                      <div style={{ fontSize: 18, fontWeight: 800, color: T.primary }}>&#10003;</div>
                    ) : (
                      <div style={{ fontSize: 15, fontWeight: 800, color: ac.color }}>#{globalIndex + 1}</div>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ width: 1, flexShrink: 0, background: `linear-gradient(to bottom, transparent, ${isDone ? T.primary : ac.color}45, transparent)` }} />

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    {item.tag && (
                      <div style={{ fontSize: 11, color: ac.color, fontWeight: 700, marginBottom: 2, letterSpacing: 0.3 }}>{item.tag}</div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.t1, lineHeight: 1.35, marginBottom: item.subtitle ? 3 : 0 }}>
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div style={{
                        fontSize: 12, color: T.t2, lineHeight: 1.4,
                        overflow: "hidden", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      }}>
                        {item.subtitle}
                      </div>
                    )}
                  </div>

                  {/* Top-right "已练" badge */}
                  {isDone && (
                    <div style={{ position: "absolute", top: 6, right: 8, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", color: T.primary, background: T.primarySoft, borderRadius: 4, padding: "1px 6px", border: `1px solid ${T.primaryMist}`, lineHeight: 1.6 }}>已练</div>
                  )}

                  {/* Right arrow */}
                  <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", flexShrink: 0 }}>
                    <Arrow color={ac.color} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
