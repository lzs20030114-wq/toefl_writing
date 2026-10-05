// 功能引导图 · 拼版层：把真实截图裁切、放进手机/浏览器外框，再叠圈注、编号和说明。
// 画布 1080×1440（3:4，小红书/朋友圈竖图）；所有坐标都是画布像素，绝对定位。
import fs from "node:fs";
import path from "node:path";

export const W = 1080;
export const H = 1440;

export const C = {
  ink: "#0E2A1F", ink2: "#3D5249", muted: "#6F837A",
  brand: "#0D9668", brandDark: "#087355", cyan: "#0891B2",
  accent: "#FF6A3D", mark: "#FFE27A",
};

export const union = (...bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w)), btm = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
};

/** 圈注：r 为画布坐标框。 */
export const ring = (r, { pad = 8, radius = 16, z = 5, color = C.accent, width = 5 } = {}) =>
  `<div class="ring" style="left:${r.x - pad}px;top:${r.y - pad}px;width:${r.w + pad * 2}px;height:${r.h + pad * 2}px;border-radius:${radius}px;border-width:${width}px;border-color:${color};z-index:${z}"></div>`;

/** 编号圆点：(cx, cy) 为圆心。 */
export const badge = (n, cx, cy, { z = 7, color = C.accent, size = 52 } = {}) =>
  `<div class="badge" style="left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px;line-height:${size - 8}px;font-size:${Math.round(size * 0.54)}px;background:${color};z-index:${z}">${n}</div>`;

/** 鼠标指针（点击示意），(x, y) 为指针尖。 */
export const cursor = (x, y, { z = 8, size = 46 } = {}) =>
  `<svg class="cursor" style="left:${x - 4}px;top:${y - 2}px;z-index:${z}" width="${size}" height="${size * 1.3}" viewBox="0 0 24 31"><path d="M2 2 L2 24 L8 18.5 L12.2 28 L16 26.3 L11.9 17 L19.5 17 Z" fill="#fff" stroke="#0E2A1F" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

/** 两部手机之间的「→」。 */
export const flipArrow = (cx, top) =>
  `<div class="flip" style="left:${cx - 34}px;top:${top}px"><svg width="68" height="68" viewBox="0 0 68 68"><circle cx="34" cy="34" r="32" fill="#fff" stroke="${C.accent}" stroke-width="4"/><path d="M22 34h22M36 25l9 9-9 9" fill="none" stroke="${C.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;

/** 截图上方的黑色小标签（「正面」「翻面后」）。 */
export const cap = (text, x, y) => `<div class="cap" style="left:${x}px;top:${y}px">${text}</div>`;

/** 右侧对齐的编号说明：(x, cy) 为第一行中线。 */
export const side = (n, title, sub, x, cy, w) =>
  `<div class="side" style="left:${x}px;top:${cy - 24}px;width:${w}px"><span class="cn">${n}</span><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;

/**
 * 绑定一套图的截图元数据（capture 写出的 meta.json），返回取框与放图的工具。
 * shotsRel：posters.html 引用截图的相对路径。
 */
export function kit(meta, { shotsRel = "shots" } = {}) {
  const need = (shot) => {
    if (!meta[shot]) throw new Error(`meta.json 里没有截图 ${shot}，先跑 capture`);
    return meta[shot];
  };
  /** findBoxes 存下的命名框。 */
  const box = (shot, name) => {
    const b = need(shot).boxes?.[name];
    if (!b) throw new Error(`box not found: ${shot} / ${name}`);
    return b;
  };
  /** boxesIn 存下的元素列表里按文字取最小的那个框。 */
  const boxByText = (shot, text, { tag, exact = false } = {}) => {
    const list = (need(shot).boxes || []).filter((b) => (!tag || b.tag === tag) && (exact ? b.text === text : (b.text || "").includes(text)));
    list.sort((a, b) => a.w * a.h - b.w * b.h);
    if (!list[0]) throw new Error(`box not found: ${shot} / ${text}`);
    return list[0];
  };
  /**
   * 放一张截图。crop 用截图视口的 CSS px（和 boxes 同一坐标系），s 为缩放。
   * frame: card（圆角卡片）| browser（浏览器窗）| phone（手机外框）| bare
   * 返回 { html, map(box)→画布坐标, rect }。
   */
  const fig = ({ shot, crop, x, y, s, frame = "card", radius = 22, url = "treepractice.com", z = 1, shadow = "0 24px 60px rgba(14,42,31,.16), 0 4px 14px rgba(14,42,31,.06)" }) => {
    const m = need(shot);
    const clip = m.clip;
    const c = crop || clip;
    const w = Math.round(c.w * s), h = Math.round(c.h * s);
    const img = `<div style="position:relative;width:${w}px;height:${h}px;overflow:hidden;${frame === "phone" ? `border-radius:${radius}px;` : ""}">
    <img src="${shotsRel}/${m.file}" style="position:absolute;left:${-(c.x - clip.x) * s}px;top:${-(c.y - clip.y) * s}px;width:${clip.w * s}px;height:${clip.h * s}px;max-width:none"></div>`;
    let html, ox = 0, oy = 0, Wd = w, Ht = h;
    if (frame === "browser") {
      const bar = 54;
      oy = bar; Ht = h + bar;
      html = `<div class="fig" style="left:${x}px;top:${y}px;width:${w}px;border-radius:${radius}px;box-shadow:${shadow};background:#fff;overflow:hidden;z-index:${z};outline:1px solid rgba(14,42,31,.08)">
      <div class="bbar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i><span>${url}</span></div>${img}</div>`;
    } else if (frame === "phone") {
      const bez = 14;
      ox = bez; oy = bez; Wd = w + bez * 2; Ht = h + bez * 2;
      html = `<div class="fig phone" style="left:${x}px;top:${y}px;width:${Wd}px;height:${Ht}px;border-radius:${radius + bez}px;z-index:${z};box-shadow:${shadow}">
      <div style="position:absolute;left:${bez}px;top:${bez}px">${img}</div></div>`;
    } else if (frame === "bare") {
      html = `<div class="fig" style="left:${x}px;top:${y}px;z-index:${z}">${img}</div>`;
    } else {
      html = `<div class="fig" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${radius}px;overflow:hidden;box-shadow:${shadow};z-index:${z};outline:1px solid rgba(14,42,31,.08)">${img}</div>`;
    }
    const map = (b) => ({ x: x + ox + (b.x - c.x) * s, y: y + oy + (b.y - c.y) * s, w: b.w * s, h: b.h * s });
    return { html, map, rect: { x, y, w: Wd, h: Ht } };
  };
  return { box, boxByText, fig, meta };
}

/**
 * 一张内页的外壳：顶部步骤胶囊 + 品牌 + 页码、大标题（<mark> 高亮）、副标题，
 * 底部可选编号说明条（legend）或小贴士（tip）。
 */
export function page({ n, total, step, title, sub, body, tip, legend, legendTop = 1236, brand = "TreePractice" }) {
  const lg = legend ? `<div class="legend" style="top:${legendTop}px">${legend.map((l, i) => `<div class="li"><span class="cn">${l.n ?? i + 1}</span><b>${l.t}</b>${l.s ? `<small>${l.s}</small>` : ""}</div>`).join("")}</div>` : "";
  return `<section class="poster" id="p${n}"><div class="dots"></div>
  <div class="hd">
    <div class="toprow"><div class="pill"><b>${step[0]}</b>${step[1]}</div>
      <div class="brand"><span class="logo">T</span>${brand}<span class="pg"><b>${String(n).padStart(2, "0")}</b> / ${String(total).padStart(2, "0")}</span></div></div>
    <h1>${title}</h1>
    ${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>
  ${body}
  ${lg}
  ${tip ? `<div class="ft"><div class="tip"><span class="ti">💡</span><div>${tip}</div></div></div>` : ""}
</section>`;
}

/** 封面：深色底、大标题、底部三步。 */
export function cover({ total, kicker, title, sub, body, steps, brand = "TreePractice" }) {
  return `<section class="poster cover" id="p1"><div class="dots"></div>
  <div class="hd">
    <div class="toprow"><div class="brand"><span class="logo">T</span>${brand}<span class="pg"><b>01</b> / ${String(total).padStart(2, "0")}</span></div><div class="kicker">${kicker}</div></div>
    <h1>${title}</h1>
    <div class="sub">${sub}</div>
  </div>
  ${body}
  <div class="steps">${steps.map((t, i) => `<div class="st"><span>${i + 1}</span>${t}</div>${i < steps.length - 1 ? "<i>→</i>" : ""}`).join("")}</div>
</section>`;
}

export const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#cfd8d3;font-family:'Noto Sans SC',sans-serif;-webkit-font-smoothing:antialiased}
.poster{position:relative;width:${W}px;height:${H}px;overflow:hidden;margin:0 0 40px;color:${C.ink};
  background:radial-gradient(1200px 700px at 100% 0%, #DDF3EA 0%, rgba(221,243,234,0) 60%), linear-gradient(180deg,#F6FBF8 0%,#EAF6F0 100%)}
.poster .dots{position:absolute;inset:0;background-image:radial-gradient(rgba(13,150,104,.10) 1.6px, transparent 1.6px);background-size:28px 28px;mask-image:linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,.55) 100%);-webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,.55) 100%)}
.hd{position:absolute;left:64px;right:64px;top:54px;z-index:2}
.toprow{display:flex;align-items:center;justify-content:space-between;height:50px}
.pill{display:inline-flex;align-items:center;gap:12px;height:50px;padding:0 22px 0 8px;border-radius:999px;background:#fff;box-shadow:0 4px 14px rgba(14,42,31,.08);font-weight:700;font-size:24px;color:${C.ink2}}
.pill b{display:inline-grid;place-items:center;height:36px;padding:0 14px;border-radius:999px;background:${C.brand};color:#fff;font:800 20px/1 'Plus Jakarta Sans',sans-serif;letter-spacing:.5px}
.brand{display:flex;align-items:center;gap:12px;font:800 27px/1 'Plus Jakarta Sans',sans-serif;color:${C.ink}}
.logo{width:42px;height:42px;border-radius:12px;background:linear-gradient(140deg,#0D9668,#0B7E8F);color:#fff;display:grid;place-items:center;font:800 23px/1 'Plus Jakarta Sans',sans-serif}
.pg{font:700 22px/1 'Plus Jakarta Sans',sans-serif;color:#8aa096;letter-spacing:1px;margin-left:16px;padding-left:16px;border-left:2px solid #d5e2db}
.pg b{color:${C.ink}}
h1{margin:34px 0 0;font-size:68px;line-height:1.24;font-weight:900;letter-spacing:-1px}
h1 mark{background:linear-gradient(transparent 60%, ${C.mark} 60%, ${C.mark} 92%, transparent 92%);color:inherit;padding:0 2px}
.sub{margin-top:18px;font-size:30px;line-height:1.62;color:${C.ink2};font-weight:500}
.sub q{quotes:"「" "」";color:${C.ink};font-weight:700}
.fig{position:absolute}
.fig img{display:block}
.bbar{height:54px;display:flex;align-items:center;gap:10px;padding:0 20px;background:#F3F6F4;border-bottom:1px solid #E4EAE6}
.bbar i{width:14px;height:14px;border-radius:50%;display:block}
.bbar span{margin-left:14px;flex:1;height:32px;border-radius:9px;background:#fff;color:#7d8f86;font:600 18px/32px 'Plus Jakarta Sans',sans-serif;padding:0 16px;max-width:420px}
.phone{background:#101a16}
.ring{position:absolute;border-style:solid;box-shadow:0 0 0 6px rgba(255,106,61,.16)}
.badge{position:absolute;border-radius:50%;color:#fff;font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;text-align:center;border:4px solid #fff;box-shadow:0 6px 16px rgba(255,106,61,.35)}
.cursor{position:absolute;filter:drop-shadow(0 4px 6px rgba(0,0,0,.25))}
.side{position:absolute;z-index:6}
.side .cn{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;background:${C.accent};color:#fff;font:800 24px/1 'Plus Jakarta Sans',sans-serif;border:4px solid #fff;box-shadow:0 6px 14px rgba(255,106,61,.3);vertical-align:middle;margin-right:10px}
.side b{font-size:29px;line-height:1.3;font-weight:800;color:${C.ink};vertical-align:middle}
.side small{display:block;margin-top:8px;font-size:23px;line-height:1.5;font-weight:500;color:#5A6E64}
.inset{position:absolute;left:64px;right:64px;background:#fff;border-radius:24px;box-shadow:0 12px 32px rgba(14,42,31,.09);border:1px solid rgba(14,42,31,.05);z-index:3}
.flip{position:absolute;z-index:6}
.flip svg{display:block}
.cap{position:absolute;z-index:6;font-size:22px;font-weight:800;color:#fff;background:${C.ink};border-radius:999px;padding:6px 16px;letter-spacing:1px}
.legend{position:absolute;left:64px;right:64px;display:flex;gap:16px;z-index:3}
.li{flex:1;min-width:0;position:relative;background:#fff;border-radius:20px;padding:20px;box-shadow:0 10px 28px rgba(14,42,31,.08);border:1px solid rgba(14,42,31,.05)}
.li .cn{position:absolute;left:18px;top:-20px;width:44px;height:44px;border-radius:50%;background:${C.accent};color:#fff;font:800 24px/36px 'Plus Jakarta Sans',sans-serif;text-align:center;border:4px solid #fff;box-shadow:0 6px 14px rgba(255,106,61,.3)}
.li b{display:block;margin-top:10px;font-size:28px;line-height:1.3;font-weight:800;color:${C.ink}}
.li small{display:block;margin-top:6px;font-size:23px;line-height:1.45;font-weight:500;color:#5A6E64}
.ft{position:absolute;left:64px;right:64px;bottom:46px;display:flex;align-items:center;gap:18px;z-index:3}
.tip{flex:1;display:flex;align-items:flex-start;gap:16px;background:rgba(255,255,255,.86);border:1px solid rgba(14,42,31,.06);border-radius:22px;padding:18px 24px;font-size:26px;line-height:1.5;font-weight:500;color:${C.ink2};box-shadow:0 8px 24px rgba(14,42,31,.06)}
.tip .ti{flex:none;width:40px;height:40px;border-radius:12px;background:#FFF3D6;display:grid;place-items:center;font-size:24px;margin-top:-1px}
.tip b{color:${C.ink};font-weight:700}
.cover{background:radial-gradient(900px 600px at 85% 8%, rgba(45,212,191,.22), rgba(45,212,191,0) 60%),linear-gradient(165deg,#0A3226 0%,#0D4535 52%,#0F5E4C 100%);color:#fff}
.cover .dots{background-image:radial-gradient(rgba(255,255,255,.10) 1.6px, transparent 1.6px);mask-image:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.6) 100%);-webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.6) 100%)}
.cover .brand{color:#fff}.cover .pg{color:#9fc7b6;border-left-color:rgba(255,255,255,.25)}.cover .pg b{color:#fff}
.cover .logo{background:#fff;color:#0D7A5A}
.cover .kicker{font-size:24px;font-weight:700;color:#CFEDE1;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:10px 20px}
.cover h1{margin-top:58px;font-size:76px;line-height:1.26;letter-spacing:-1.5px;color:#fff}
.cover h1 mark{background:linear-gradient(transparent 62%, rgba(255,214,90,.92) 62%, rgba(255,214,90,.92) 92%, transparent 92%);color:#fff}
.cover .sub{color:#CDE6DB;font-size:31px;margin-top:26px}
.steps{position:absolute;left:64px;right:64px;bottom:58px;display:flex;align-items:center;gap:14px;z-index:6}
.steps .st{flex:1;display:flex;align-items:center;justify-content:center;gap:12px;height:76px;border-radius:20px;background:#fff;color:${C.ink};font-size:27px;font-weight:800;box-shadow:0 14px 34px rgba(0,0,0,.25)}
.steps .st span{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:${C.accent};color:#fff;font:800 22px/1 'Plus Jakarta Sans',sans-serif}
.steps i{font-style:normal;color:#9fd8c2;font-size:30px;font-weight:800}
`;

/** 写出 posters.html + manifest.json（render.mjs 按 manifest 命名成图）。 */
export function writeSet(dir, posters, manifest) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${posters.join("\n")}</body></html>`;
  fs.writeFileSync(path.join(dir, "posters.html"), html);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
}
