"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { C, FONT, PageShell, SurfaceCard } from "../shared/ui";
import { SpeakButton } from "../shared/SpeakButton";
import { useVocabBook } from "./useVocabBook";
import { VocabReview } from "./VocabReview";
import { STATE, currentRetrievability, isDue } from "../../lib/vocab/srs";
import { MATURE_DAYS, sortByUrgency } from "../../lib/vocab/book";

const ACCENT = "#0891B2";
const ACCENT_SOFT = "#ECFEFF";
const PAGE_SIZE = 60;

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "due", label: "今天要复习" },
  { id: "new", label: "还没开始" },
  { id: "learning", label: "学习中" },
  { id: "mature", label: "已记牢" },
];

function stateLabel(card, now) {
  if (card.state === STATE.NEW) return { text: "未开始", color: C.t3, bg: C.bdrSubtle };
  if (card.state === STATE.LEARNING || card.state === STATE.RELEARNING) {
    return { text: "学习中", color: "#c2760a", bg: "#fffbeb" };
  }
  if ((card.scheduledDays || 0) >= MATURE_DAYS) return { text: "已记牢", color: "#0d9668", bg: "#ecfdf5" };
  if (isDue(card, now)) return { text: "待复习", color: "#dc2626", bg: "#fef2f2" };
  return { text: "复习中", color: ACCENT, bg: ACCENT_SOFT };
}

function dueLabel(card, now) {
  if (card.state === STATE.NEW) return "等待放出";
  const ms = new Date(card.due).getTime() - now.getTime();
  if (ms <= 0) return "现在";
  const days = ms / 86400000;
  if (days < 1) return `${Math.max(1, Math.round(ms / 60000))} 分钟后`;
  if (days < 31) return `${Math.round(days)} 天后`;
  return `${Math.round(days / 30)} 个月后`;
}

function Stat({ value, label, color }) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: "center", padding: "12px 6px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.t1, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.t2, marginTop: 3 }}>{label}</div>
    </div>
  );
}

export default function VocabNotebook({ onBack }) {
  const {
    cards, stats, limits, setLimits, ready, isLoggedIn,
    makeQueue, grade, remove, reset, setProductive, schedule,
  } = useVocabBook();
  const [queue, setQueue] = useState(null); // 非 null = 正在复习
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const now = useMemo(() => new Date(), [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let out = sortByUrgency(cards, now);
    if (filter === "due") out = out.filter((c) => c.state !== STATE.NEW && isDue(c, now));
    else if (filter === "new") out = out.filter((c) => c.state === STATE.NEW);
    else if (filter === "learning") out = out.filter((c) => c.state === STATE.LEARNING || c.state === STATE.RELEARNING);
    else if (filter === "mature") out = out.filter((c) => (c.scheduledDays || 0) >= MATURE_DAYS);
    if (kw) out = out.filter((c) => c.word.includes(kw) || (c.def || "").toLowerCase().includes(kw));
    return out;
  }, [cards, filter, q, now]);

  const startReview = () => {
    const next = makeQueue();
    if (next.length === 0) return;
    setQueue(next);
  };

  if (queue) {
    return (
      <PageShell narrow>
        <VocabReview
          initialQueue={queue}
          onGrade={grade}
          onExit={() => setQueue(null)}
        />
      </PageShell>
    );
  }

  return (
    <PageShell narrow>
      {/* 顶栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{
            border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 8,
            padding: "6px 13px", fontSize: 12, cursor: "pointer", fontFamily: FONT,
          }}
        >
          ← 返回
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.t1, letterSpacing: -0.4 }}>单词本</h1>
          <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>
            阅读/听力复盘时点原文里的词 → 词典弹窗点「☆ 收藏到单词本」，之后按遗忘曲线安排复习。
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          style={{
            marginLeft: "auto", border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2,
            borderRadius: 8, padding: "6px 13px", fontSize: 12, cursor: "pointer", fontFamily: FONT, flexShrink: 0,
          }}
        >
          ⚙ 每日配额
        </button>
      </div>

      {settingsOpen && (
        <SurfaceCard style={{ padding: "14px 18px", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              { key: "newPerDay", label: "每天放出新词", max: 100, note: "备考期建议 15–25：放太多，三四天后会堆出还不完的复习债" },
              { key: "maxReviews", label: "每天复习上限", max: 500, note: "0 = 不限。到期的词优先，超出的顺延到明天" },
            ].map((f) => (
              <label key={f.key} style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>{f.label}</div>
                <input
                  type="number"
                  min={0}
                  max={f.max}
                  value={limits[f.key]}
                  onChange={(e) => setLimits({ [f.key]: Math.max(0, Math.min(f.max, Number(e.target.value) || 0)) })}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 8,
                    border: `1px solid ${C.bdr}`, fontSize: 14, fontFamily: FONT, outline: "none",
                  }}
                />
                <div style={{ fontSize: 10.5, color: C.t3, marginTop: 5, lineHeight: 1.6 }}>{f.note}</div>
              </label>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* 今日复习 */}
      <SurfaceCard style={{ padding: 0, marginBottom: 14, overflow: "hidden" }}>
        <div style={{
          background: `linear-gradient(135deg, ${ACCENT} 0%, #0d9668 100%)`,
          padding: "20px 22px", color: "#fff",
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 600 }}>今天该过的词</div>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, letterSpacing: -1 }}>
              {ready ? stats.todo : "—"}
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
              {ready && stats.todo > 0
                ? `到期复习 ${Math.min(stats.dueReview, limits.maxReviews || stats.dueReview)} · 新词 ${stats.newToday}`
                : "今天的词都过完了，明天同一时间再来"}
            </div>
            {/* 超出每日上限的部分明确说「顺延」，而不是任它堆成一面三百张的墙 —— 
                那面墙才是真正让人弃用单词本的东西。 */}
            {ready && limits.maxReviews > 0 && stats.dueReview > limits.maxReviews && (
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                还有 {stats.dueReview - limits.maxReviews} 个到期的词已顺延到明天
              </div>
            )}
          </div>
          <button
            onClick={startReview}
            disabled={!ready || stats.todo === 0}
            style={{
              border: "none", borderRadius: 12, padding: "13px 28px",
              fontSize: 15, fontWeight: 800, fontFamily: FONT, flexShrink: 0,
              background: !ready || stats.todo === 0 ? "rgba(255,255,255,0.25)" : "#fff",
              color: !ready || stats.todo === 0 ? "rgba(255,255,255,0.7)" : ACCENT,
              cursor: !ready || stats.todo === 0 ? "default" : "pointer",
            }}
          >
            {stats.todo > 0 ? "开始复习" : "已完成"}
          </button>
        </div>
        <div style={{ display: "flex", borderTop: `1px solid ${C.bdrSubtle}` }}>
          <Stat value={ready ? stats.total : "—"} label="收藏总数" />
          <div style={{ width: 1, background: C.bdrSubtle }} />
          {/* 刻意用「预计记得」而不是「已复习多少张」：后者衡量的是工作量，
              把工作量做成成就指标会激励用户多刷、调高留存率，正好和
              「用最少时间记住最多词」相反。 */}
          <Stat value={ready ? stats.knowledge : "—"} label="预计现在记得" color={ACCENT} />
          <div style={{ width: 1, background: C.bdrSubtle }} />
          <Stat value={ready ? stats.learning : "—"} label="学习中" color="#c2760a" />
          <div style={{ width: 1, background: C.bdrSubtle }} />
          <Stat value={ready ? stats.mature : "—"} label="已记牢" color="#0d9668" />
        </div>
      </SurfaceCard>

      {ready && schedule.sprint && (
        <div style={{
          fontSize: 12, color: "#9a3412", background: "#fff7ed", border: "1px solid #fed7aa",
          borderRadius: 10, padding: "9px 13px", marginBottom: 14, lineHeight: 1.7,
        }}>
          <strong>考前冲刺档已开启</strong>：距考试不到 10 天，复习目标留存率已自动从 90% 提到 95%，
          间隔也压在考试日之前。今天的词会比平时多一些，这是故意的。
        </div>
      )}

      {!isLoggedIn && ready && cards.length > 0 && (
        <div style={{
          fontSize: 12, color: "#92400e", background: C.softAmber, border: "1px solid #fde68a",
          borderRadius: 10, padding: "9px 13px", marginBottom: 14, lineHeight: 1.7,
        }}>
          当前没登录，单词本只存在这台设备的浏览器里。登录后会自动同步到账号，换设备也能接着背。
        </div>
      )}

      {/* 空状态 */}
      {ready && cards.length === 0 && (
        <SurfaceCard style={{ padding: "36px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📖</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 8 }}>单词本还是空的</div>
          <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.9, maxWidth: 420, margin: "0 auto 20px" }}>
            做完一套阅读后，在「阅读练习记录」里打开任意一次练习就能看到原文。
            在原文里点任何一个词，弹出的词典卡片下方有「☆ 收藏到单词本」，点一下这个词就进来了。
            <br />
            从自己读过的文章里攒词，比背现成词表记得牢得多——因为每个词都带着你见过它的那句话。
          </div>
          <Link
            href="/reading/progress"
            style={{
              display: "inline-block", background: ACCENT, color: "#fff", textDecoration: "none",
              borderRadius: 10, padding: "10px 22px", fontSize: 13.5, fontWeight: 700,
            }}
          >
            去阅读练习记录
          </Link>
        </SurfaceCard>
      )}

      {/* 词表 */}
      {ready && cards.length > 0 && (
        <SurfaceCard style={{ padding: "14px 16px 6px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {FILTERS.map((f) => {
                const on = filter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => { setFilter(f.id); setShown(PAGE_SIZE); }}
                    style={{
                      border: `1px solid ${on ? ACCENT : C.bdr}`,
                      background: on ? ACCENT_SOFT : "#fff",
                      color: on ? ACCENT : C.t2,
                      borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: on ? 700 : 500,
                      cursor: "pointer", fontFamily: FONT,
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setShown(PAGE_SIZE); }}
              placeholder="搜词或释义"
              style={{
                marginLeft: "auto", width: 150, padding: "5px 11px", borderRadius: 999,
                border: `1px solid ${C.bdr}`, fontSize: 12, fontFamily: FONT, outline: "none",
              }}
            />
          </div>

          {list.length === 0 ? (
            <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: C.t3 }}>
              这一类里还没有词
            </div>
          ) : (
            list.slice(0, shown).map((card) => {
              const st = stateLabel(card, now);
              const r = currentRetrievability(card, now);
              // 写作/口语来源的词天然走产出方向，这个开关对它们是常开且不可点的。
              const forcedProductive = card.source === "writing" || card.source === "speaking";
              const productiveOn = forcedProductive || card.productive === true;
              return (
                <div
                  key={card.word}
                  style={{
                    display: "flex", gap: 12, alignItems: "flex-start",
                    padding: "11px 2px", borderBottom: `1px solid ${C.bdrSubtle}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: C.t1, wordBreak: "break-word" }}>
                        {card.display || card.word}
                      </span>
                      {card.phonetic && (
                        <span style={{ fontSize: 11, color: C.t3, fontFamily: "'Courier New', monospace" }}>
                          /{card.phonetic}/
                        </span>
                      )}
                      <SpeakButton word={card.display || card.word} size={26} style={{ alignSelf: "center" }} />
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: st.color, background: st.bg,
                        borderRadius: 5, padding: "1px 7px",
                      }}>
                        {st.text}
                      </span>
                    </div>
                    {card.def && (
                      <div style={{
                        fontSize: 12, color: C.t2, marginTop: 3, lineHeight: 1.6,
                        overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      }}>
                        {card.def.replace(/\n/g, " / ")}
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, color: C.t3, marginTop: 4 }}>
                      下次 {dueLabel(card, now)}
                      {card.reps > 0 && ` · 复习 ${card.reps} 次`}
                      {card.lapses > 0 && ` · 忘过 ${card.lapses} 次`}
                      {r != null && ` · 此刻记得 ${Math.round(r * 100)}%`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    <button
                      onClick={forcedProductive ? undefined : () => setProductive(card.word, !card.productive)}
                      disabled={forcedProductive}
                      title={
                        forcedProductive
                          ? "写作/口语来源的词默认要会写"
                          : "进入复习后改成拼写卡：给释义，拼出英文"
                      }
                      style={{
                        border: `1px solid ${productiveOn ? ACCENT : C.bdr}`,
                        background: productiveOn ? ACCENT_SOFT : "#fff",
                        color: productiveOn ? ACCENT : C.t3,
                        borderRadius: 7, padding: "3px 8px", fontSize: 11,
                        cursor: forcedProductive ? "default" : "pointer", fontFamily: FONT,
                      }}
                    >
                      要会写
                    </button>
                    {card.reps > 0 && (
                      <button
                        onClick={() => reset(card.word)}
                        title="打回新词重新学"
                        style={{
                          border: `1px solid ${C.bdr}`, background: "#fff", color: C.t3,
                          borderRadius: 7, padding: "3px 8px", fontSize: 11, cursor: "pointer", fontFamily: FONT,
                        }}
                      >
                        重学
                      </button>
                    )}
                    <button
                      onClick={() => remove(card.word)}
                      title="从单词本移除"
                      style={{
                        border: `1px solid ${C.bdr}`, background: "#fff", color: C.t3,
                        borderRadius: 7, padding: "3px 8px", fontSize: 11, cursor: "pointer", fontFamily: FONT,
                      }}
                    >
                      移除
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {list.length > shown && (
            <button
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              style={{
                width: "100%", border: "none", background: "transparent", color: ACCENT,
                padding: "12px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
              }}
            >
              还有 {list.length - shown} 个，展开
            </button>
          )}
        </SurfaceCard>
      )}
    </PageShell>
  );
}
