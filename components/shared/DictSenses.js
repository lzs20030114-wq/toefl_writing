"use client";
import { Fragment } from "react";
import { C } from "./ui";
import { parseSenses } from "../../lib/dict/core";

/**
 * 词典条目按词性铺开的只读视图（复习卡背面用）。
 *
 * 为什么不直接把词典那段文本原样贴上去：ECDICT 的释义是 `vt. 改变, 使多样化` 这种
 * 行话 + 逗号串。`vt.` / `vi.` / `a.` / `ad.` 对着卡片的学生没有义务认得，而
 * 「这个词做名词是什么意思、做动词又是什么意思」恰恰是背单词时最该一眼看见的结构。
 *
 * 领域义项（`[计] 改变`）单独按灰色处理并给出中文全称：这一类是最容易骗人的 ——
 * 看不懂那个字，却会把它当成这个词的常用意思。灰着摆出来 + 一句脚注，
 * 用户就知道「可以跳过」。
 */

const ACCENT = "#0891B2";
const ACCENT_SOFT = "#ECFEFF";

function Tag({ children, muted }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.7,
        color: muted ? C.t3 : ACCENT,
        background: muted ? C.bdrSubtle : ACCENT_SOFT,
        border: `1px solid ${muted ? C.bdr : "#a5e8f0"}`,
        borderRadius: 6,
        padding: "0 6px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** 一组词性标（通用词性在前、领域标灰在后）。没有任何标时返回 null。 */
function GroupTags({ group }) {
  const has = group.posLabels.length + group.domainLabels.length > 0;
  if (!has) return null;
  return (
    <>
      {group.posLabels.map((l, i) => (
        <Tag key={`p${i}`}>{l}</Tag>
      ))}
      {group.domainLabels.map((l, i) => (
        <Tag key={`d${i}`} muted>
          {l}
        </Tag>
      ))}
    </>
  );
}

/**
 * 一条释义（卡片正面/背面的主释义那一行）：义项用大字，词性/领域收成小标跟在后面。
 * 拆不出结构（用户自己敲的释义、词典没收录）就原样显示。
 */
export function DefLine({ text, empty = "（这个词收藏时没有释义）", style }) {
  const groups = parseSenses(text);
  if (groups.length === 0) {
    return <div style={style}>{String(text || "").trim() || empty}</div>;
  }
  return (
    <div style={style}>
      {groups.map((g, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 6,
            marginTop: i === 0 ? 0 : 4,
          }}
        >
          <span style={{ minWidth: 0 }}>{g.senses.join("、")}</span>
          <GroupTags group={g} />
        </div>
      ))}
    </div>
  );
}

/**
 * 整条词典释义：一行一个词性。
 * 领域义项全灰，并在末尾补一句「这类是专业领域的说法」—— 用户问的就是这个。
 */
export function DictSenses({ text }) {
  const groups = parseSenses(text);
  if (groups.length === 0) return null;
  const hasDomain = groups.some((g) => g.domains.length > 0);
  return (
    <div>
      <div
        style={{
          display: "grid",
          // 左列是词性标、右列是义项；右列必须 minmax(0,1fr)，
          // 否则一长串不断行的义项会顶穿份额把标签挤没
          gridTemplateColumns: "auto minmax(0, 1fr)",
          columnGap: 10,
          rowGap: 6,
          alignItems: "baseline",
        }}
      >
        {groups.map((g, i) => {
          const domainOnly = g.posTags.length === 0 && g.domains.length > 0;
          return (
            <Fragment key={i}>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.posLabels.length + g.domainLabels.length > 0 ? (
                  <GroupTags group={g} />
                ) : (
                  <span style={{ fontSize: 11, color: C.t3 }}>释义</span>
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: domainOnly ? C.t3 : C.t1,
                  minWidth: 0,
                  wordBreak: "break-word",
                }}
              >
                {g.senses.join("、")}
              </div>
            </Fragment>
          );
        })}
      </div>
      {hasDomain && (
        <div style={{ fontSize: 11, color: C.t3, marginTop: 8, lineHeight: 1.7 }}>
          灰色那行是该词在专业领域里的说法，学术阅读里基本不会这么用，认一眼跳过就行。
        </div>
      )}
    </div>
  );
}
