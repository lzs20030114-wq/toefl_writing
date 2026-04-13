"use client";

import { SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";

export function ComingSoonSection({ section, isChallenge, fadeIn }) {
  const accent = SECTION_ACCENTS[section.id] || SECTION_ACCENTS.writing;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 340, textAlign: "center", padding: "48px 24px", ...fadeIn(200) }}>
      {/* Icon */}
      <div
        style={{
          width: 80, height: 80, borderRadius: 20,
          background: isChallenge ? "rgba(255,255,255,0.04)" : accent.soft,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 40,
          marginBottom: 24,
        }}
      >
        {section.icon}
      </div>

      {/* Title */}
      <h2 style={{ fontSize: 24, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, margin: "0 0 8px", fontFamily: HOME_FONT }}>
        {section.label}
      </h2>
      <div style={{ fontSize: 14, color: isChallenge ? CH.t2 : T.t2, marginBottom: 20 }}>
        {section.labelZh}
      </div>

      {/* Coming soon badge */}
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 20px",
          borderRadius: 999,
          background: isChallenge ? "rgba(255,255,255,0.04)" : accent.soft,
          border: `1px solid ${isChallenge ? CH.cardBorder : accent.color + "30"}`,
          fontSize: 13, fontWeight: 600,
          color: isChallenge ? CH.t2 : accent.color,
        }}
      >
        <span style={{ fontSize: 16 }}>🚧</span>
        即将推出
      </div>

      {/* Description */}
      <div style={{ fontSize: 13, color: isChallenge ? CH.t2 : T.t3, lineHeight: 1.6, marginTop: 16, maxWidth: 320 }}>
        {section.descriptionZh}
      </div>
    </div>
  );
}
