export const HOME_TOKENS = {
  bg: "#F4F7F5",
  card: "#FFFFFF",
  bdr: "#DDE5DF",
  bdrSubtle: "#EBF0ED",
  bgSoft: "#F7FAF9",
  t1: "#1A2420",
  t2: "#5A6B62",
  t3: "#94A39A",
  primary: "#0D9668",
  primaryDeep: "#087355",
  primarySoft: "#ECFDF5",
  primaryMist: "#D1FAE5",
  amber: "#D97706",
  amberSoft: "#FFFBEB",
  cyan: "#0891B2",
  cyanSoft: "#ECFEFF",
  indigo: "#6366F1",
  indigoSoft: "#EEF2FF",
  rose: "#E11D48",
  roseSoft: "#FFF1F2",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
  shadowHover: "0 5px 16px rgba(10,40,25,0.10)",
  // NavSidebar tokens
  navBg: "#F8FAFB",
  navBdr: "#E2E8F0",
  navItemActive: "#ECFDF5",
  navItemHover: "#F1F5F9",
};

export const CHALLENGE_TOKENS = {
  bg: "#0A0A12",
  card: "#111118",
  cardBorder: "#2A1525",
  t1: "#E8E8EC",
  t2: "#8888A0",
  accent: "#FF2222",
  nav: "#0D0D14",
  navBorder: "#FF2222",
  timeBg: "#1A0A10",
  // NavSidebar tokens
  navBg: "#0A0A10",
  navBdr: "#1E1525",
  navItemActive: "rgba(255,30,30,0.08)",
  navItemHover: "rgba(255,255,255,0.04)",
};

export const HOME_FONT = "'Plus Jakarta Sans','Noto Sans SC','Segoe UI',sans-serif";

export const TASK_ACCENTS = [
  { color: HOME_TOKENS.amber, soft: HOME_TOKENS.amberSoft },
  { color: HOME_TOKENS.cyan, soft: HOME_TOKENS.cyanSoft },
  { color: HOME_TOKENS.indigo, soft: HOME_TOKENS.indigoSoft },
];

export const HOME_PAGE_CSS = `
@keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes ch-crtFlash{0%{opacity:0}5%{opacity:1}100%{opacity:0}}
@keyframes ch-screenShake{0%,100%{transform:translateX(0)}10%{transform:translateX(-3px)}20%{transform:translateX(3px)}30%{transform:translateX(-2px)}40%{transform:translateX(2px)}50%{transform:translateX(-1px)}60%{transform:translateX(1px)}70%{transform:translateX(0)}}
@keyframes ch-vignette{0%,100%{opacity:.7}50%{opacity:.4}}
@keyframes ch-glowPulse{0%,100%{opacity:.8}50%{opacity:.3}}
@keyframes ch-ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes ch-sweep{0%{left:-30%}100%{left:130%}}
@keyframes ch-gradRot{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes ch-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@media (min-width: 2000px) {
  .home-shell { max-width: min(1760px, 76vw) !important; }
}
/* 中等宽度让任务卡占满右侧，备考卡片移到内容下方，功能仍可访问。 */
@media (min-width: 769px) and (max-width: 1280px) {
  .home-shell { display: grid !important; grid-template-columns: 220px minmax(0, 1fr); }
  .home-nav-sidebar { grid-column: 1; grid-row: 1 / 3; }
  .home-shell > :nth-child(2) { grid-column: 2; grid-row: 1; min-width: 0; }
  .home-study-col {
    grid-column: 2; grid-row: 2;
    display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr));
    width: auto !important; min-width: 0 !important;
    position: static !important; align-self: start !important;
  }
}
@media (min-width: 769px) and (max-width: 1100px) {
  .home-shell { padding: 24px 24px 48px !important; gap: 18px !important; grid-template-columns: 200px minmax(0, 1fr); }
  .home-nav-sidebar { width: 200px !important; min-width: 200px !important; }
  .tp-home-header { flex-wrap: wrap !important; }
}
@media (min-width: 769px) and (max-width: 980px) {
  .home-shell { padding: 20px 20px 40px !important; gap: 16px !important; grid-template-columns: 180px minmax(0, 1fr); }
  .home-nav-sidebar { width: 180px !important; min-width: 180px !important; }
  .home-grid { grid-template-columns: minmax(0, 1fr) !important; }
  .home-study-col { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
`;
