import { C, FONT } from "../shared/ui";

/** 阅读、听力共用的卡面尺寸和键帽；调度和播放由各自复习组件持有。 */
export const reviewCardStyle = {
  position: "relative", background: "#fff", border: `1px solid ${C.bdr}`, borderRadius: 16,
  boxShadow: C.shadow, padding: "28px 24px", minHeight: 250,
  display: "flex", flexDirection: "column",
};
export const reviewKbd = (color, border) => ({
  fontSize: 11, fontWeight: 700, border: `1px solid ${border}`, borderRadius: 5,
  padding: "0 6px", lineHeight: "18px", color, background: "transparent",
});

export const reviewMenuButton = {
  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer",
  fontSize: 13, fontWeight: 600, color: C.t1, fontFamily: FONT, textAlign: "left",
};
