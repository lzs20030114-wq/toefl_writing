"use client";

import { useEffect, useMemo, useState } from "react";
import { Btn } from "../shared/ui";
import { McqReview } from "../realBank/review/McqReview";
import { buildReviewModel } from "../../lib/realBankReview";

// 交卷后直接复用练习记录的复盘；只适配当前题面，不再读一次历史记录。
export function ListeningResultReview({ subtype, results, item, items }) {
  const session = useMemo(() => ({
    id: `listening-result-${item?.id || items?.map((it) => it.id).join("-") || subtype}`,
    type: "listening",
    details: {
      ...item, subtype, results, items,
      itemId: item?.id, itemIds: item ? [item.id] : items?.map((it) => it.id),
      transcript: item?.transcript || item?.announcement || item?.lecture || "",
    },
  }), [subtype, results, item, items]);
  const model = useMemo(() => buildReviewModel(session, subtype), [session, subtype]);
  const [filter, setFilter] = useState("all");
  const [opened, setOpened] = useState({});
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const update = () => setWide(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const correct = model.units.filter((u) => u.lv === "ok").length;
  const defaultOpen = (i) => model.units[i]?.lv !== "ok" || (correct === model.units.length && i === 0);
  const ctx = {
    wide,
    pass: (u) => filter === "all" || (filter === "ok" ? u.lv === "ok" : u.lv !== "ok"),
    isOpen: (i) => opened[i] ?? defaultOpen(i),
    toggle: (i) => setOpened((prev) => ({ ...prev, [i]: !(prev[i] ?? defaultOpen(i)) })),
    emptyText: filter === "ok" ? "没有答对的题目。" : "没有错题。",
  };
  return (
    <div data-testid="listening-result-review">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
        {[["all", "全部", model.units.length], ["bad", "错题", model.units.length - correct], ["ok", "答对", correct]].map(([value, label, count]) => (
          <Btn key={value} variant={filter === value ? "primary" : "secondary"} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label} {count}</Btn>
        ))}
        <Btn variant="secondary" onClick={() => setOpened(Object.fromEntries(model.units.map((u) => [u.idx, true])))}>全部展开</Btn>
        <Btn variant="secondary" onClick={() => setOpened(Object.fromEntries(model.units.map((u) => [u.idx, false])))}>全部收起</Btn>
      </div>
      <McqReview session={session} subtype={subtype} model={model} vid={session.id} ctx={ctx} />
    </div>
  );
}
