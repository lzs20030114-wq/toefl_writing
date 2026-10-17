"use client";
import React from "react";
import { C, SurfaceCard } from "../shared/ui";
import { ETS, EtsAvatar, etsSize } from "../shared/etsExamUi";

// etsLook：真题模考里去掉卡片框和标题条，按真题界面直接排正文（只换皮，内容不变）。
export function WritingPromptPanel({ type, pd, etsLook = false }) {
  const emailGoals = Array.isArray(pd?.goals) ? pd.goals : [];
  const professorName = String(pd?.professor?.name || "Professor");
  const professorText = String(pd?.professor?.text || "");
  const students = Array.isArray(pd?.students) ? pd.students : [];
  const professorInitial = professorName.trim() ? professorName.trim().slice(0, 1).toUpperCase() : "P";
  const course = pd?.course ? String(pd.course) : "";

  if (etsLook) return <EtsPromptColumn type={type} pd={pd} />;
  const Shell = SurfaceCard;
  return (
    <Shell style={{ overflow: "hidden" }}>
      {!etsLook && <div style={{ background: C.ltB, padding: "12px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdrSubtle }}>
        {type === "email" ? "Email Prompt" : "Discussion Board"}
      </div>}
      {type === "email" ? (
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 14, color: C.t1, lineHeight: 1.7, margin: "0 0 12px" }}>{pd?.scenario || ""}</p>
          <div style={{ borderTop: "1px solid " + C.bdr, paddingTop: 12, marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{pd?.direction || "Complete the email writing task."}</div>
            <ul style={{ margin: "0 0 12px", paddingLeft: 22 }}>
              {emailGoals.map((g, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 4, lineHeight: 1.5 }}>{g}</li>
              ))}
            </ul>
            <div style={{ fontSize: 13, color: C.t2, fontStyle: "italic" }}>Write as much as you can and in complete sentences.</div>
          </div>
        </div>
      ) : (
        <div>
          {/* TOEFL instruction block */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid " + C.bdr, fontSize: 12.5, color: C.t2, lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 6px" }}>Your professor is teaching a class on <b style={{ color: C.t1 }}>{course || "social studies"}</b>. Write a post responding to the professor's question.</p>
            <p style={{ margin: "0 0 4px" }}>In your response, you should</p>
            <ul style={{ margin: "0 0 4px", paddingLeft: 20 }}>
              <li>express and support your personal opinion</li>
              <li>make a contribution to the discussion in your own words</li>
            </ul>
            <p style={{ margin: 0 }}>An effective response will contain at least 100 words.</p>
          </div>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid " + C.bdr }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.nav, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                {professorInitial}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{professorName}</div>
                <div style={{ fontSize: 11, color: C.t2 }}>Professor</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{professorText}</p>
          </div>
          {students.map((s, i) => (
            <div key={i} style={{ padding: "14px 20px 14px 40px", borderBottom: i < students.length - 1 ? "1px solid " + C.bdr : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: i ? "#e8913a" : "#4a90d9", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                  {String(s?.name || "学生").slice(0, 1)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s?.name || "Student"}</div>
              </div>
              <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{s?.text || ""}</p>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

// ── 真题（ETS 机考）外观 ──
// 对照 5.6 真题 PDF 写作截图（1152 宽）：左栏正文约 16.5px、行高 1.35、#333，指令句加粗，实心圆点列表；
// 讨论题左栏 = 说明 + 居中的教授头像和名字 + 教授的问题，同学的帖子在右栏（EtsStudentPosts）。
const ETS_PROMPT_TEXT = { fontFamily: ETS.font, color: ETS.text, fontSize: etsSize(16.5), lineHeight: 1.36 };
const ETS_AVATAR_CSS = `.tp-ets-prompt-avatar svg { width: 100% !important; height: 100% !important; box-shadow: none !important; }`;

function EtsPersonAvatar({ seed, female, size, label }) {
  return (
    <span className="tp-ets-prompt-avatar" style={{ width: etsSize(size), height: etsSize(size), flexShrink: 0, display: "block" }}>
      <EtsAvatar seed={seed} female={female} label={label} size={size} />
    </span>
  );
}

function EtsBullets({ items }) {
  return (
    <ul style={{ margin: `${etsSize(10)} 0 ${etsSize(4)}`, padding: `0 0 0 ${etsSize(46)}`, listStyle: "none" }}>
      {items.map((g, i) => (
        <li key={i} style={{ position: "relative", margin: `0 0 ${etsSize(6)}`, lineHeight: 1.55 }}>
          <span aria-hidden="true" style={{ position: "absolute", left: `calc(-1 * ${etsSize(26)})`, top: "0.52em", width: etsSize(9), height: etsSize(9), borderRadius: "50%", background: "#111" }} />
          {g}
        </li>
      ))}
    </ul>
  );
}

function emailDirection(pd) {
  const d = String(pd?.direction || "").trim() || (pd?.to ? `Write an email to ${pd.to}.` : "Write an email.");
  return /do the following/i.test(d) ? d : `${d} In your email, do the following:`;
}

function EtsPromptColumn({ type, pd }) {
  if (type === "email") {
    const goals = Array.isArray(pd?.goals) ? pd.goals : [];
    return (
      <div data-testid="writing-prompt-ets" style={ETS_PROMPT_TEXT}>
        <p style={{ margin: 0 }}>{pd?.scenario || ""}</p>
        <p style={{ margin: `${etsSize(10)} 0 0`, fontWeight: 700, color: ETS.ink }}>{emailDirection(pd)}</p>
        <EtsBullets items={goals} />
        <p style={{ margin: `${etsSize(26)} 0 0` }}>Write as much as you can and in complete sentences.</p>
      </div>
    );
  }
  const course = pd?.course ? String(pd.course) : "social studies";
  const professorName = String(pd?.professor?.name || "Professor");
  return (
    <div data-testid="writing-prompt-ets" style={ETS_PROMPT_TEXT}>
      <style>{ETS_AVATAR_CSS}</style>
      <p style={{ margin: 0 }}>Your professor is teaching a class on {course}. Write a post responding to the professor’s question.</p>
      <p style={{ margin: `${etsSize(12)} 0 0`, fontWeight: 700, color: ETS.ink }}>In your response, you should do the following.</p>
      <EtsBullets items={["Express and support your opinion.", "Make a contribution to the discussion in your own words."]} />
      <p style={{ margin: `${etsSize(6)} 0 0` }}>An effective response will contain at least 100 words.</p>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: `${etsSize(22)} 0 ${etsSize(22)}` }}>
        <EtsPersonAvatar seed={professorName} female={isFemaleName(professorName)} size={140} label={professorName} />
        <div style={{ marginTop: etsSize(12) }}>{professorName}</div>
      </div>
      <p style={{ margin: 0 }}>{String(pd?.professor?.text || "")}</p>
    </div>
  );
}

/** 讨论题右栏上方：每位同学一行 —— 左边圆形头像 + 名字，右边帖子正文。 */
export function EtsStudentPosts({ pd }) {
  const students = Array.isArray(pd?.students) ? pd.students : [];
  if (!students.length) return null;
  return (
    <div data-testid="writing-students-ets" style={{ ...ETS_PROMPT_TEXT, display: "flex", flexDirection: "column", gap: etsSize(14) }}>
      <style>{ETS_AVATAR_CSS}</style>
      {students.map((s, i) => {
        const name = String(s?.name || "Student");
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: `${etsSize(122)} minmax(0, 1fr)`, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <EtsPersonAvatar seed={name} female={isFemaleName(name, i)} size={88} label={name} />
              <div style={{ marginTop: etsSize(6) }}>{name}</div>
            </div>
            <p style={{ margin: 0, minWidth: 0 }}>{s?.text || ""}</p>
          </div>
        );
      })}
    </div>
  );
}

// 题库没有性别字段：常见名字粗判一下头像发型，判不出就按顺序交替（只影响占位插图）。
const FEMALE_NAMES = new Set(["kelly", "claire", "emma", "anna", "sarah", "emily", "jessica", "olivia", "sophia", "mia", "lisa", "julia", "maria", "rachel", "laura", "kate", "amy", "linda", "grace", "chloe", "lucy", "hannah", "megan", "nina", "zoe", "alice", "ella", "isabella", "ava", "jennifer", "susan", "karen", "mary", "jane", "lily", "rose"]);
const MALE_NAMES = new Set(["paul", "andrew", "john", "james", "david", "michael", "tom", "mark", "peter", "daniel", "kevin", "brian", "jason", "eric", "ryan", "alex", "sam", "chris", "matt", "mike", "adam", "ben", "jack", "luke", "noah", "ethan", "henry", "leo", "max", "oliver", "william", "robert", "steven", "tony", "frank"]);
function isFemaleName(name, index = 1) {
  const first = String(name || "").replace(/^(dr|prof|professor|mr|mrs|ms|miss)\.?\s+/i, "").trim().split(/\s+/)[0].toLowerCase();
  if (/^(mrs|ms|miss)\b/i.test(String(name || "").trim())) return true;
  if (FEMALE_NAMES.has(first)) return true;
  if (MALE_NAMES.has(first)) return false;
  return index % 2 === 0;
}
