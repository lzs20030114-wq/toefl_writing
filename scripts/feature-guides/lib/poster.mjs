// 功能引导图 · 拼版层（3:4，1080×1440，给手机看）
//
// 每一页：左上标题 + 说明；右上是电脑网页的整页缩略图，橙框标出放大的位置；
// 下面是放大的局部（真实截图），说明标签直接贴在对应元素旁边、用线连到元素上。
// 标签的位置在浏览器里按实际文字宽度摆（见 LAYOUT_JS），超出画布会自动收回。
import fs from "node:fs";
import path from "node:path";

export const W = 1080;
export const H = 1440;

export const C = {
  ink: "#0E2A1F", ink2: "#3D5249", muted: "#6F837A",
  brand: "#0D9668", accent: "#FF6A3D",
};

export const union = (...bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w)), btm = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
};
export const rect = (x, y, w, h) => ({ x, y, w, h });
const pad = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 });
/** 截图坐标里把框往外扩，可带圆角（给 zoom 的 dim 亮区用）。 */
export const grow = (r, p, radius = 0) => ({ ...pad(r, p), r: radius });
/** ring() 返回的圈四条边的中点：标签连线从这里出发。 */
export const L = (r) => ({ x: r.x, y: r.cy });
export const R = (r) => ({ x: r.x + r.w, y: r.cy });
export const T = (r) => ({ x: r.cx, y: r.y });
export const B = (r) => ({ x: r.cx, y: r.y + r.h });
export const bottom = (r) => r.y + r.h;

/** 绑定一套图的截图元数据（capture 写出的 meta.json）。 */
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
  return { meta, need, box, boxByText, shotsRel };
}

/**
 * 一页引导图。用法：
 *   const p = page(K, { n, total, shot, title, desc });
 *   const z = p.zoom({ crop, y });                 // 放大区（可以有多条；shot 可换成同一页的另一张截图）
 *   p.ring(z.map(box)); p.label({ ... });
 *   p.footer("…"); p.html();
 */
export function page(K, { n, total, shot, title, desc }) {
  const m = K.need(shot);
  const parts = [];
  const marks = [];
  let foot = "";
  const img = (crop, x, y, s, radius = 22, src = m) => {
    const clip = src.clip;
    const w = Math.round(crop.w * s), h = Math.round(crop.h * s);
    return { w, h, html: `<div class="fig" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${radius}px">
      <img src="${K.shotsRel}/${src.file}" style="position:absolute;left:${-(crop.x - clip.x) * s}px;top:${-(crop.y - clip.y) * s}px;width:${clip.w * s}px;height:${clip.h * s}px;max-width:none"></div>` };
  };
  const api = {
    /**
     * 放大一块。crop 用截图的 CSS px；默认横向占满（宽 1040）。
     * dim：只亮这些框（截图坐标），其余压暗——焦点落在要讲的东西上。
     */
    zoom({ crop, y, s = null, x = null, dim = null, radius = 22, tag = true, shot: other = null }) {
      const scale = s || 1040 / crop.w;
      const w = Math.round(crop.w * scale);
      const left = x == null ? Math.round((W - w) / 2) : x;
      const f = img(crop, left, y, scale, radius, other ? K.need(other) : m);
      const map = (b) => ({ x: left + (b.x - crop.x) * scale, y: y + (b.y - crop.y) * scale, w: b.w * scale, h: b.h * scale });
      const screen = { x: left, y, w: f.w, h: f.h };
      parts.push(f.html);
      if (dim) parts.push(dimLayer(screen, dim.map((d) => ({ ...map(d), r: (d.r || 0) * scale })), radius));
      if (tag) parts.push(`<div class="zoomtag" style="left:${left + 22}px;top:${y - 17}px">放大</div>`);
      marks.push(crop);
      return { map, screen, s: scale, crop, pt: (x0, y0) => ({ x: left + (x0 - crop.x) * scale, y: y + (y0 - crop.y) * scale }) };
    },
    /** 圈注（画布坐标）。返回加了内边距的圈，连线从圈边上出发。 */
    ring(r, { p = 6, radius = 12, z = 6 } = {}) {
      const q = pad(r, p);
      parts.push(`<div class="ring" style="left:${q.x}px;top:${q.y}px;width:${q.w}px;height:${q.h}px;border-radius:${radius}px;z-index:${z}"></div>`);
      return { ...q, cx: q.x + q.w / 2, cy: q.y + q.h / 2 };
    },
    /**
     * 说明标签。side 决定 at 是标签的哪个点：left=右边缘中点（标签在左边），right=左边缘中点，
     * above=下边缘中点，below=上边缘中点。from：连线起点（画布坐标点，可多个）；
     * via：连线拐点（可选，用来绕开文字）。
     */
    label({ t, s, side = "right", at, from = [], via = [], align = null }) {
      const froms = (Array.isArray(from) ? from : [from]).filter(Boolean);
      const a = align || (side === "left" ? "right" : null); // 标签在元素左边时文字靠右，贴着连线那一侧
      parts.push(`<div class="lab" data-side="${side}" data-ax="${at.x}" data-ay="${at.y}" data-from='${JSON.stringify(froms)}' data-via='${JSON.stringify(via)}'${a ? ` style="text-align:${a}"` : ""}>${t}${s ? `<small>${s}</small>` : ""}</div>`);
    },
    /** 额外标记缩略图上的位置（截图坐标）。 */
    mark(crop) { marks.push(crop); },
    raw(html) { parts.push(html); },
    footer(html) { foot = html; },
    html() {
      const ts = 374 / m.clip.w;
      const th = Math.round(m.clip.h * ts);
      const thumb = img({ x: m.clip.x, y: m.clip.y, w: m.clip.w, h: m.clip.h }, 650, 104, ts, 10);
      const markHtml = marks.map((c) => `<div class="mark" style="left:${650 + c.x * ts}px;top:${104 + c.y * ts}px;width:${c.w * ts}px;height:${c.h * ts}px"></div>`).join("");
      return `<section class="pg" id="p${n}" style="height:${H}px">
  <div class="brand"><span class="logo">T</span>TreePractice<span class="k">功能说明</span></div>
  <div class="num"><b>${String(n).padStart(2, "0")}</b> / ${String(total).padStart(2, "0")}</div>
  <h1>${title}</h1>
  <div class="desc">${desc}</div>
  ${thumb.html.replace('class="fig"', 'class="fig thumb"')}
  ${markHtml}
  <div class="cap" style="left:650px;top:${104 + th + 12}px">电脑网页全貌，橙框处放大在下面</div>
  ${parts.join("\n  ")}
  ${foot ? `<div class="foot">${foot}</div>` : ""}
  <svg class="ln" width="${W}" height="${H}"></svg>
</section>`;
    },
  };
  return api;
}

/** 截图上除 holes 以外压暗一点。 */
function dimLayer(screen, holes, radius) {
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="dim" style="left:${screen.x}px;top:${screen.y}px" width="${screen.w}" height="${screen.h}">
  <defs><mask id="${id}"><rect width="${screen.w}" height="${screen.h}" fill="#fff"/>
  ${holes.map((h) => `<rect x="${h.x - screen.x}" y="${h.y - screen.y}" width="${h.w}" height="${h.h}" rx="${h.r || 0}" fill="#000"/>`).join("")}
  </mask></defs><rect width="${screen.w}" height="${screen.h}" rx="${radius}" fill="rgba(10,30,22,.32)" mask="url(#${id})"/></svg>`;
}

/** 浏览器里：按实际尺寸摆标签、收进画布、画连线。 */
const LAYOUT_JS = `
(async () => {
  await document.fonts.ready;
  const M = 22;
  for (const pg of document.querySelectorAll(".pg")) {
    const W = pg.clientWidth, H = pg.clientHeight;
    const svg = pg.querySelector("svg.ln");
    let paths = "";
    for (const el of pg.querySelectorAll(".lab")) {
      const w = el.offsetWidth, h = el.offsetHeight;
      const ax = +el.dataset.ax, ay = +el.dataset.ay, side = el.dataset.side;
      let x = side === "left" ? ax - w : side === "right" ? ax : ax - w / 2;
      let y = side === "above" ? ay - h : side === "below" ? ay : ay - h / 2;
      x = Math.max(M, Math.min(W - M - w, x));
      y = Math.max(M, Math.min(H - M - h, y));
      el.style.left = x + "px"; el.style.top = y + "px";
      const via = JSON.parse(el.dataset.via || "[]");
      for (const f of JSON.parse(el.dataset.from || "[]")) {
        const last = via.length ? via[via.length - 1] : f;
        const ex = Math.max(x, Math.min(x + w, last.x)), ey = Math.max(y, Math.min(y + h, last.y));
        const pts = [f, ...via, { x: ex, y: ey }];
        paths += '<path d="' + pts.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" ") + '" fill="none" stroke="#FF6A3D" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
          + '<circle cx="' + f.x + '" cy="' + f.y + '" r="6.5" fill="#FF6A3D" stroke="#fff" stroke-width="2.5"/>';
      }
    }
    svg.innerHTML = paths;
    const foot = pg.querySelector(".foot");
    if (foot) {
      let low = 0;
      for (const el of pg.querySelectorAll(".fig:not(.thumb), .lab, .ring")) low = Math.max(low, el.offsetTop + el.offsetHeight);
      foot.style.top = Math.min(low + 34, H - 40 - foot.offsetHeight) + "px";
    }
  }
  document.body.dataset.laidOut = "1";
})();
`;

export const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#c9d3ce;font-family:'Noto Sans SC',sans-serif;-webkit-font-smoothing:antialiased}
.pg{position:relative;width:${W}px;overflow:hidden;margin:0 0 40px;background:linear-gradient(180deg,#F4FAF7 0%,#E9F5EF 100%);color:${C.ink}}
.brand{position:absolute;left:56px;top:46px;display:flex;align-items:center;gap:12px;font:800 26px/1 'Plus Jakarta Sans',sans-serif;color:${C.ink}}
.logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(140deg,#0D9668,#0B7E8F);color:#fff;display:grid;place-items:center;font:800 22px/1 'Plus Jakarta Sans',sans-serif}
.brand .k{margin-left:10px;padding-left:14px;border-left:2px solid #cfe0d7;font:600 22px/1 'Noto Sans SC',sans-serif;color:${C.muted}}
.num{position:absolute;left:470px;top:56px;font:700 22px/1 'Plus Jakarta Sans',sans-serif;color:#8aa096;letter-spacing:1px}
.num b{color:${C.ink}}
h1{position:absolute;left:56px;top:110px;margin:0;font-size:62px;line-height:1.2;font-weight:900;letter-spacing:-.5px;white-space:nowrap}
.desc{position:absolute;left:56px;top:196px;width:560px;font-size:29px;line-height:1.55;font-weight:500;color:${C.ink2}}
.desc b,.desc q{color:${C.ink};font-weight:700}
.desc q,.foot q,.lab q{quotes:"「" "」"}
.fig{position:absolute;overflow:hidden;box-shadow:0 24px 60px rgba(14,42,31,.16),0 4px 14px rgba(14,42,31,.06);outline:1px solid rgba(14,42,31,.08)}
.fig img{display:block;position:absolute}
.thumb{box-shadow:0 10px 26px rgba(14,42,31,.14)}
.mark{position:absolute;border:3px solid ${C.accent};border-radius:5px;box-shadow:0 0 0 3px rgba(255,106,61,.2);z-index:4}
.cap{position:absolute;font-size:21px;font-weight:700;color:${C.muted};z-index:4}
.dim{position:absolute;z-index:5;pointer-events:none}
.ring{position:absolute;border:4px solid ${C.accent};box-shadow:0 0 0 5px rgba(255,106,61,.18)}
.lab{position:absolute;z-index:8;background:${C.accent};color:#fff;border-radius:14px;padding:9px 16px 10px;font-size:27px;line-height:1.32;font-weight:800;box-shadow:0 8px 18px rgba(200,70,30,.28);white-space:nowrap}
.lab small{display:block;font-size:22px;line-height:1.35;font-weight:600;color:#FFE9DF;margin-top:2px}
svg.ln{position:absolute;left:0;top:0;z-index:7;pointer-events:none;overflow:visible}
.foot{position:absolute;left:56px;right:56px;font-size:25px;line-height:1.55;color:#52665C;font-weight:500}
.zoomtag{position:absolute;z-index:9;background:${C.ink};color:#fff;font-size:21px;font-weight:800;border-radius:999px;padding:6px 14px;letter-spacing:1px}
.foot b{color:${C.ink};font-weight:700}
`;

/**
 * 一套图按顺序编号写出：pages = [[文件名, (n, total) => page(...)], ...]。
 * 文件名就是成图名（render 出 <文件名>.png），习惯写成「01-查词和收藏」。
 */
export function writePages(dir, pages) {
  const posters = [];
  const manifest = [];
  pages.forEach(([name, fn], i) => {
    posters.push(fn(i + 1, pages.length).html());
    manifest.push({ id: `p${i + 1}`, name });
  });
  writeSet(dir, posters, manifest);
  return manifest;
}

/** 写出 posters.html + manifest.json（render.mjs 按 manifest 命名成图）。 */
export function writeSet(dir, posters, manifest) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${posters.join("\n")}<script>${LAYOUT_JS}</script></body></html>`;
  fs.writeFileSync(path.join(dir, "posters.html"), html);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
}
