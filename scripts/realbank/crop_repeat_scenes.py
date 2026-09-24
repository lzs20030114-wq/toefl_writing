# -*- coding: utf-8 -*-
"""真题复述题「场景插图」—— 源料体检 + 抠图（阶段 1：只落 .codex-tmp）。

背景：真考的复述题（Speaking Q1-Q7）共用**一张场景插图**，每一题在同一张图上
高亮不同的物件（打印机 → 椅子 → 纸盘…），界面上只有一行
"Listen and repeat only once."。题库 data/realBank/speaking/repeat.json 里只有
句子文本，插图全丢了。所以一套要出 1 张底图（无高亮）+ 逐题帧（`_s<题号>`）。

三类来源（按 item.id 分）：
  1) 第一来源 real_repeat_<日期>_1：套目录里有「X.X 口语.pdf」= 考场截图 PDF，
     一屏一张截图。靠 OCR 里的「Speaking | Question n of 11」把屏和题号对上，
     再在屏内用连通域找插图块。**题号取真题题号**，不是数组下标
     （3.15 只有 s1/s3/s4/s5/s6），Q8-Q11 是 interview，不裁。
  2) rf 系列：商家重排 docx，内嵌那张图就是底图本体（已裁好、无高亮），整张收。
  3) rp 拼盘：一个 item 混着多份 Form（句子题号能到 42），一张图对不上，本轮整类不出。

校验 fail-closed：每张裁图过一次 Qwen-VL 三问（是不是场景图 / 有没有界面文字或
播放器 / 有没有水印），外加本地尺寸闸（同套各帧形状要一致）。任一不过只记录不上传。

源目录（REALBANK_SRC，默认桌面那份）**全程只读**；产物只落
.codex-tmp/realbank/repeat-scenes/（webp + 整页红框预览 + manifest.json）。
本阶段不上传、不改题库、不碰前端。

用法:
  python scripts/realbank/crop_repeat_scenes.py --survey
  python scripts/realbank/crop_repeat_scenes.py --ids real_repeat_310_1 --dry-run
  python scripts/realbank/crop_repeat_scenes.py --set 310,46 --dry-cost
  python scripts/realbank/crop_repeat_scenes.py --all

退出码：0 正常；2 用法/输入缺失；3 Qwen 系统性失败（鉴权/余额/网络）。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))


def _load(name: str, filename: str):
    """同目录脚本不是包，按路径加载（与 crop_materials.py 加载 ocr_images 的做法一致）。"""
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cm = _load("rb_crop_materials", "crop_materials.py")     # 源定位 + 单元枚举，整块复用
ocr_images = cm.ocr_images                               # 同一份 OCR 缓存口径
slice_audio = _load("rb_slice_audio", "slice_audio.py")  # find_ffmpeg / 音频扩展名口径

BANK = os.path.join(REPO_ROOT, "data", "realBank", "speaking", "repeat.json")
OUT_DIR = os.path.join(REPO_ROOT, ".codex-tmp", "realbank", "repeat-scenes")
SURVEY_JSON = os.path.join(OUT_DIR, "survey.json")
PREVIEW_DIR = os.path.join(OUT_DIR, "survey-preview")

# OCR 会把空格吃光（"Listenandrepeatonlyonce"），所以命中判定先把非字母数字全压掉。
SCENE_MARKS = ("repeatonlyonce", "listenandrepeat")
VIDEO_EXT = (".mp4", ".mov")
AUDIO_EXT = (".mp3", ".m4a", ".wav")
SPEAKING_WORDS = ("口语", "speaking")

PREVIEW_ZOOM = 1.5
PREVIEW_MAX_PAGES = 4


# ── 文本 ───────────────────────────────────────────────────────────────────
def squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(text or "").lower())


def scene_pages(page_texts: dict) -> list:
    """{页/图序: 文本} → 命中复述屏指令的页码（升序）。"""
    hits = []
    for pno, text in sorted(page_texts.items()):
        flat = squash(text)
        if any(m in flat for m in SCENE_MARKS):
            hits.append(pno)
    return hits


# ── 题库 ───────────────────────────────────────────────────────────────────
def load_sets() -> list[dict]:
    with open(BANK, "r", encoding="utf-8") as fh:
        items = json.load(fh).get("items") or []
    out = []
    for it in items:
        m = re.match(r"^real_repeat_(.+?)_\d+$", str(it.get("id") or ""))
        setkey = m.group(1) if m else ""
        out.append({
            "set_id": setkey,
            "item_id": it.get("id"),
            "source": str(it.get("source") or ""),
            "origin": "rf" if setkey.startswith("rf") else ("rp" if setkey.startswith("rp") else "first"),
            "sentences": len(it.get("sentences") or []),
            "scenario_head": str(it.get("scenario") or "")[:60],
        })
    return sorted(out, key=lambda r: (r["origin"], r["set_id"]))


# ── 源定位 ─────────────────────────────────────────────────────────────────
def pdf_page_count(path: str) -> int:
    import fitz
    with fitz.open(path) as doc:
        return doc.page_count


# 商家 docx 里混着装饰件：8.19 的第一张是横条形「播放器」图标（1600×310），
# 8.22 的 word/media/ 还带一条 0 字节的目录项。按**像素形状**分「候选/装饰」比按
# 字节数稳（7.8 那张手绘场景图只有 16KB，比 8.19 的播放器图标还小）。
# 只是给人看的分类，一张都不删（原始张数照样报）。
MIN_SCENE_SIDE = 250
SCENE_RATIO = (0.4, 3.0)


def docx_images(path: str) -> list[tuple[str, int, bool]]:
    """docx 内嵌图 → [(名字, 字节数, 是否像场景图)]。"""
    from PIL import Image

    out = []
    try:
        z = zipfile.ZipFile(path)
    except Exception:
        return out
    with z:
        for n in sorted(x for x in z.namelist() if x.startswith("word/media/")):
            info = z.getinfo(n)
            if n.endswith("/") or info.file_size == 0:
                continue
            try:
                with Image.open(io.BytesIO(z.read(n))) as im:
                    w, h = im.size
            except Exception:
                out.append((n, info.file_size, False))
                continue
            ratio = w / float(h or 1)
            ok = min(w, h) >= MIN_SCENE_SIDE and SCENE_RATIO[0] <= ratio <= SCENE_RATIO[1]
            out.append((n, info.file_size, ok))
    return out


def first_source_speaking(source: str) -> tuple[str | None, dict]:
    """第一来源 → (口语 PDF 路径, {页码: OCR 文本})。

    复用 crop_materials.first_source_pdf（本次给它加了 section 形参，默认仍是「阅读」）
    与 crop_materials.first_source_ocr（`<套名>__<pdf stem>.txt` 缓存口径原样）。
    """
    pdf = cm.first_source_pdf(source, section="口语")
    if not pdf:
        return None, {}
    return pdf, cm.first_source_ocr(source, pdf)


def second_source_speaking(setkey: str) -> tuple[str | None, dict, str | None, bool]:
    """rf/rp → (口语文档路径, {图/页序: 缓存 OCR}, 套题文件夹)。

    文件夹定位直接复用 crop_materials.second_source_folder（它内部用的是
    ocr_images.setkey_for 的同一套 rf/rp 前缀口径）。
    """
    folder = cm.second_source_folder(setkey)
    if not folder:
        return None, {}, None, False
    docs = []
    for fn in sorted(os.listdir(folder)):
        if fn.startswith("~$") or not fn.lower().endswith((".docx", ".pdf")):
            continue
        docs.append(fn)
    # 必须认「文件名以 Speaking/口语 开头」而不是「包含」：8.19 那份
    # 「Answers【答案+听力原文+口语写作范文等 均在此】.pdf」名字里也有「口语」，
    # 用包含匹配会把答案大册当成口语分册（实测就撞了）。
    named = [fn for fn in docs if re.match(r"(speaking|口语)", os.path.splitext(fn)[0], re.I)]
    fallback = False
    if named:
        pick = named[0]
    elif docs:
        # rp 拼盘偶尔没有口语分册（7.05），只好退回最大那份并标记为兜底。
        pick = max(docs, key=lambda fn: os.path.getsize(os.path.join(folder, fn)))
        fallback = True
    else:
        return None, {}, folder, False
    path = os.path.join(folder, pick)
    cached = ocr_images.cached_texts(setkey, ocr_images.cache_base(pick))
    return path, cached, folder, fallback


def media_files(folder: str) -> list[str]:
    """套题目录里的口语相关音视频（口径与 slice_audio.audio_files 的 speaking 分支一致）。"""
    out = []
    for root, _dirs, names in os.walk(folder):
        for n in sorted(names):
            low = n.lower()
            if not low.endswith(VIDEO_EXT + AUDIO_EXT):
                continue
            if "downloading" in low:
                continue
            if any(k.lower() in low for k in SPEAKING_WORDS):
                out.append(os.path.join(root, n))
    return out


def date_token(rec: dict) -> str:
    """套 → 源料里通用的日期串（"4.20" / "6.15" / "8.30"），用来在别处找同日录屏。"""
    if rec["origin"] == "first":
        m = re.match(r"^(\d+)\.(\d+)", rec["source"])
    else:
        m = re.match(r"^r[fp](\d{2})(\d{2})$", rec["set_id"])
    if not m:
        return ""
    return f"{int(m.group(1))}.{int(m.group(2))}"


_VIDEO_INDEX: list[str] | None = None


def video_index() -> list[str]:
    """整个源目录里的屏幕录像（.mp4/.mov）。

    套目录里往往没有录像，真正的录屏堆在「月份文件夹」下（`4月/4.20/4.20 R6L6.mp4`），
    所以除了套目录，还要按日期串在全局索引里找一遍，免得漏报「其实有录屏」。
    """
    global _VIDEO_INDEX
    if _VIDEO_INDEX is None:
        hits = []
        for root, _dirs, names in os.walk(cm.DESKTOP_SRC):
            if "__MACOSX" in root:
                continue
            for n in names:
                if n.startswith("._") or not n.lower().endswith(VIDEO_EXT):
                    continue
                hits.append(os.path.join(root, n))
        _VIDEO_INDEX = sorted(hits)
    return _VIDEO_INDEX


def nearby_videos(rec: dict) -> list[str]:
    tok = date_token(rec)
    if not tok:
        return []
    pat = re.compile(r"(?<!\d)" + re.escape(tok) + r"(?!\d)")
    return [p for p in video_index()
            if pat.search(os.path.relpath(p, cm.DESKTOP_SRC)) and "（OG）" not in p]


_FFPROBE: str | None | bool = False


def ffprobe() -> str | None:
    global _FFPROBE
    if _FFPROBE is False:
        ff = slice_audio.find_ffmpeg()
        if ff:
            cand = os.path.join(os.path.dirname(ff), "ffprobe.exe")
            _FFPROBE = cand if os.path.exists(cand) else None
        else:
            _FFPROBE = None
    return _FFPROBE or None


def duration_seconds(path: str) -> float | None:
    fp = ffprobe()
    if not fp:
        return None
    try:
        out = subprocess.run([fp, "-v", "error", "-show_entries", "format=duration",
                              "-of", "default=nw=1:nk=1", path],
                             capture_output=True, text=True, timeout=60)
        return round(float(out.stdout.strip()), 1)
    except Exception:
        return None


def set_folder(rec: dict) -> str | None:
    if rec["origin"] == "first":
        for root in (cm.CONVERTED_SRC, cm.DESKTOP_SRC):
            p = os.path.join(root, rec["source"])
            if os.path.isdir(p):
                return p
        return None
    return cm.second_source_folder(rec["set_id"])


# ── 体检 ───────────────────────────────────────────────────────────────────
def survey_one(rec: dict) -> dict:
    row = dict(rec)
    doc = None
    pages = 0
    cached: dict = {}
    if rec["origin"] == "first":
        doc, cached = first_source_speaking(rec["source"])
        if doc:
            pages = pdf_page_count(doc)
    else:
        doc, cached, _folder, fallback = second_source_speaking(rec["set_id"])
        row["doc_is_fallback"] = fallback
        if doc:
            if doc.lower().endswith(".pdf"):
                pages = pdf_page_count(doc)
            else:
                imgs = docx_images(doc)
                pages = len(imgs)
                row["scene_candidates"] = sum(1 for _n, _sz, ok in imgs if ok)
    row["doc"] = os.path.relpath(doc, cm.DESKTOP_SRC) if doc and doc.startswith(cm.DESKTOP_SRC) else doc
    row["doc_kind"] = ("pdf" if doc and doc.lower().endswith(".pdf")
                       else ("docx" if doc else None))
    row["pages"] = pages
    row["ocr_cached_pages"] = len(cached)
    row["scene_pages"] = scene_pages(cached)

    folder = set_folder(rec)
    row["folder"] = folder
    vids, auds = [], []
    for p in (media_files(folder) if folder else []):
        entry = {"file": os.path.basename(p), "seconds": duration_seconds(p)}
        (vids if p.lower().endswith(VIDEO_EXT) else auds).append(entry)
    row["videos"] = vids
    row["audios"] = auds
    seen = {v["file"] for v in vids}
    row["videos_nearby"] = [
        {"path": os.path.relpath(p, cm.DESKTOP_SRC), "seconds": duration_seconds(p)}
        for p in nearby_videos(rec) if os.path.basename(p) not in seen
    ]
    row["verdict"] = verdict_of(row)
    return row


# 体检结论（只描述源料形态，**不做任何抠图判断**）：
#   exam_shot_pdf    分科「X.X 口语.pdf」= 考场截图，每题一屏，场景图在屏中央（带闲鱼水印）
#   whole_paper_pdf  1~2 月的整卷 PDF，口语屏混在几十页里；截图偏小且是灰度
#   vendor_docx_img  rf/rp 商家重排 docx，内嵌图就是场景图本体（已裁好、无水印、灰度）
#   vendor_typeset   rp 商家自排 PDF，图是商家自绘的分步小图 + 满版水印，非考场原图
#   none             源料里没有任何图
def verdict_of(row: dict) -> str:
    if row["doc_kind"] == "docx":
        return "vendor_docx_img" if row.get("scene_candidates", 0) > 0 else "none"
    if row["doc_kind"] != "pdf":
        return "none"
    if row["origin"] == "first":
        return "exam_shot_pdf" if row["pages"] <= 12 else "whole_paper_pdf"
    return "vendor_typeset" if row["scene_pages"] else "none"


# ── 预览渲染（只读源料，落 .codex-tmp） ─────────────────────────────────────
def render_preview(row: dict) -> list[str]:
    """把命中页（没命中就前几页）按 zoom 1.5 渲染成 PNG，供人眼核对有没有场景插图。"""
    import fitz

    doc_path = row.get("doc")
    if not doc_path:
        return []
    if not os.path.isabs(doc_path):
        doc_path = os.path.join(cm.DESKTOP_SRC, doc_path)
    if not os.path.exists(doc_path):
        return []
    if doc_path.lower().endswith(".docx"):
        # rf 系列是商家重排 docx：没有「页」，只有内嵌图；直接把原图倒出来看。
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        made = []
        with zipfile.ZipFile(doc_path) as z:
            names = sorted(n for n in z.namelist() if n.startswith("word/media/"))
            for i, n in enumerate(names[:PREVIEW_MAX_PAGES], start=1):
                ext = os.path.splitext(n)[1] or ".png"
                out = os.path.join(PREVIEW_DIR, f"{row['set_id']}_img{i}{ext}")
                with open(out, "wb") as fh:
                    fh.write(z.read(n))
                made.append(out)
        return made
    want = (row.get("scene_pages") or list(range(1, row.get("pages", 0) + 1)))[:PREVIEW_MAX_PAGES]
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    made = []
    with fitz.open(doc_path) as d:
        for pno in want:
            if pno < 1 or pno > d.page_count:
                continue
            pix = d[pno - 1].get_pixmap(matrix=fitz.Matrix(PREVIEW_ZOOM, PREVIEW_ZOOM))
            out = os.path.join(PREVIEW_DIR, f"{row['set_id']}_p{pno}.png")
            pix.save(out)
            made.append(out)
    return made


# ══════════════════════════════════════════════════════════════════════════
# 抠图（阶段 1：只落 .codex-tmp，不上传、不写题库、不碰源目录）
# ══════════════════════════════════════════════════════════════════════════
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

MANIFEST = os.path.join(OUT_DIR, "manifest.json")
VERIFY_SETKEY = "repeatscene"          # Qwen 缓存键 repeatscene__<set_id>__img<n>.txt
CNY_PER_IMAGE = ocr_images.CNY_PER_IMAGE

MAX_WIDTH = 1200
WEBP_QUALITY = 80
PAD = 6
REPEAT_QMAX = 7                        # Q8-Q11 是 interview，不属于复述题
# 绝对尺寸只用来抓「粗暴漏裁」（2.28 的 Q1 只有多数帧的 27%）。不能收太紧：
# 同一套里各屏截图的缩放本来就不一样（1.28A 三种比例，实测每张图都完整），
# 真正可靠的是长宽比。
SIZE_TOL = 0.20
SIZE_GLOW_TOL = 0.30                   # 比多数帧大这么多才算异常（整图高亮的外发光能撑到 +12%）
SHAPE_TOL = 0.15                       # 长宽比容差
VENDOR_DRAWN_BYTES = 30000             # rf docx 图小于这个多半是商家自绘（7.8 那张 16KB）

# 「Speaking | Question n of 11」在 OCR 里的各种粘法：
# "Speaking|Question1of11" / "Speaking / Question 2 of 11" / "Speaking 1Question4of 11"
# 「Speaking」这半边 OCR 经常吃字（"peaking | Question 7 of 11"，3.16 第 3 页干脆只剩
# "Question3of11"），所以前缀整个可选 ——「Question n of 11」这串只出现在题头上，
# 放宽不会误伤；分隔符 OCR 会读成 | / 1 l I [ 各种样子，一并容忍。
Q_HEADER = re.compile(r"(?:[A-Za-z]*eaking\s*[|/1lI\[\]]*\s*)?[Qq]uestions?\s*(\d+)\s*of\s*11")

VERIFY_PROMPT = """你在看一张从托福考试截图里裁出来的小图。只输出 JSON，不要任何解释：
{"is_scene": true/false, "has_ui_text": true/false, "has_watermark": true/false}
- is_scene：整张是不是场景插图 / 示意图 / 平面图 / 照片（纯文字、按钮、播放器控件都算 false）
- has_ui_text：有没有混进考试界面文字（Speaking、Question n of 11、Listen and repeat only once、题干句子）
  或播放进度条、播放按钮、0:00/0:03、1x 倍速控件
- has_watermark：有没有水印（店铺名、闲鱼、倾斜重复大字、「低于35元」之类）"""


def bank_question_numbers(item_id: str) -> list[int]:
    """题库里这套实际存在的句子题号（id 后缀 `_s<n>` 保留了原题号，315 只有 1/3/4/5/6）。"""
    with open(BANK, "r", encoding="utf-8") as fh:
        for it in json.load(fh).get("items") or []:
            if it.get("id") != item_id:
                continue
            out = []
            for s in it.get("sentences") or []:
                m = re.search(r"_s(\d+)$", str(s.get("id") or ""))
                if m:
                    out.append(int(m.group(1)))
            return sorted(set(out))
    return []


# ── 屏与题号的对齐 ─────────────────────────────────────────────────────────
# 一屏的开头：要么是「Speaking | Question n of 11」题头，要么是只有一个 "Speaking"
# 的科目条（Section 说明屏 / 引入屏）。注意**不能**把 "SpeakingSection" 当开头 ——
# 那是同一屏里的第二行标题，认了就会把一屏切成两屏，整页对齐全错。
SCREEN_START = re.compile(r"^[ \t]*[A-Za-z]*eaking[ \t]*[|/1lI]?[ \t]*$")


def split_screens(page_text: str) -> list[str]:
    """一页 OCR → 逐屏文本块（顺序 = 页面上从上到下）。

    页面上一页装 2~4 张截图，OCR 是线性拼起来的；屏的边界只能靠「新的一屏必然以
    Speaking 科目条或题头开头」来切。切出来的块数必须与该页的截图张数相等，
    不等就整页作废 —— 宁可少几套，也不许把 Q6 的图当成 Q7 的（3.10 第 3 页
    最后一屏是 interview 引入屏，按「题头对齐到末尾几张图」会正好错一位）。
    """
    lines = (page_text or "").splitlines()
    chunks: list[list[str]] = []
    for ln in lines:
        if Q_HEADER.match(ln.strip()) or SCREEN_START.match(ln):
            chunks.append([ln])
        elif chunks:
            chunks[-1].append(ln)
        else:
            chunks = [[ln]]
    out = ["\n".join(c) for c in chunks if "".join(c).strip()]
    # 第二来源转出来的整卷 PDF，每屏顶上还印着阅卷器的浏览器条
    # （"2026年真题03 Play / Home 模块切换：… Next >"）。它排在第一个 Speaking 题头
    # **之前**，会凭空多出一块，让整页对不齐（121b/121c/127a/21b/22/228/314 全栽在这）。
    # 这种块没有题头、没有情景说明、英文字母也没几个 —— 并回它下面那一屏。
    if len(out) >= 2 and is_chrome(out[0]):
        out = ["\n".join(out[:2])] + out[2:]
    return out


def is_chrome(chunk: str) -> bool:
    if Q_HEADER.search(chunk) or is_scenario_text(chunk):
        return False
    return len(re.sub(r"[^a-z]", "", chunk.lower())) < 60


def is_scenario_text(text: str) -> bool:
    """这段文本是不是「情景说明」（引入屏），而不是只有一句 Listen and repeat only once。

    只按「有 repeat only once + 这一屏字够多」判：3.15 的引入屏被 OCR 吃掉了中间一整行
    （"…teaching you how to / Repeatonlyonce."），认死 "listen to the …" 这类原句会漏。
    Section 说明屏虽然字也多，但没有 "repeat only once" 这句，不会被误收。
    """
    flat = squash(text)
    if "repeatonlyonce" not in flat:
        return False
    return len(flat) >= 60 and not flat.startswith("listenandrepeatonlyonce")


def page_plan(page_text: str, n_images: int) -> tuple[int | None, dict[int, int], str]:
    """这一页：哪张图是底图、哪张图是第几题。返回 (底图序号, {题号: 图序号}, 说明)。

    屏块数与截图张数必须一一对上，对不上整页作废。底图只认「有情景说明且**没有**题头」
    的那一屏 —— 1~2 月整卷 PDF 把 `Question 1 of 11` 和情景说明挤在同一屏，
    那种卷因此没有底图，宁可 base=missing，也不拿高亮帧冒充底图。
    """
    chunks = split_screens(page_text)
    if len(chunks) != n_images:
        return None, {}, f"align_fail:screens={len(chunks)}!=images={n_images}"
    frames: dict[int, int] = {}
    base_idx = None
    for i, c in enumerate(chunks):
        m = Q_HEADER.search(c)
        if m:
            frames.setdefault(int(m.group(1)), i)
        elif base_idx is None and is_scenario_text(c):
            base_idx = i
    return base_idx, frames, "ok"


# ── 场景块检测 ─────────────────────────────────────────────────────────────
SCENE_MIN_W, SCENE_MIN_H = 0.10, 0.15   # 占整屏的比例下限
SCENE_RATIO_BOX = (0.55, 2.6)           # 平面图接近 1:1，最扁的也就 2.5:1
EDGE_MARGIN = 3                         # 贴边 = 截图把图切掉了一截，不要


def scene_box(img: np.ndarray) -> tuple[tuple[int, int, int, int] | None, str]:
    """在一屏考试截图里找场景插图块。

    考试界面是纯白底 + 黑字 + 一块灰调插图：把「非白」像素闭运算粘成块再取连通域，
    文字行会是又扁又矮的块（被长宽比/高度下限筛掉），插图是唯一接近方形的大块。
    整屏外框（引入屏有边框）单独排除；贴到截图边缘的块也排除 —— 那是被截断的图
    （3.10 的引入屏就把插图切了一半），裁出来会缺一块。
    """
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = (gray < 243).astype(np.uint8) * 255
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, _lab, stats, _cent = cv2.connectedComponentsWithStats(closed, 8)
    best = None
    clipped = False
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i][:5])
        if w > 0.95 * W and h > 0.95 * H:
            continue                                    # 整屏外框
        if w < SCENE_MIN_W * W or h < SCENE_MIN_H * H:
            continue
        ratio = w / float(h)
        if not (SCENE_RATIO_BOX[0] <= ratio <= SCENE_RATIO_BOX[1]):
            continue
        if x <= EDGE_MARGIN or y <= EDGE_MARGIN or x + w >= W - EDGE_MARGIN or y + h >= H - EDGE_MARGIN:
            clipped = True
            continue
        if best is None or area > best[0]:
            best = (area, (x, y, w, h))
    if best:
        return trim_player_bar(gray, best[1]), "box"
    return None, ("no_box:clipped" if clipped else "no_box")


PLAYER_GAP_MAX_DARK = 0.05    # 白缝：这一行几乎没有非白像素
PLAYER_BAR_MAX_H = 0.22       # 播放条最多占框高的两成
PLAYER_BAR_MIN_BRIGHT = 225   # 播放条底色是近白的浅蓝，插图不会这么亮


def trim_player_bar(gray: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """把粘在插图下面的播放条（`0:00/0:02  1x  ⬇`）切掉。

    1~2 月的整卷 PDF 里播放条紧贴插图底边，闭运算会把两者粘成同一个连通域
    （121a 的 Q2/Q3 框实测就把整条播放器吃进去了）。真实分界是一条**纯白缝**：
    插图最后一行 → 5~6 行全白 → 播放条（底色近白、只有几个图标）。
    所以从下往上找最后一条白缝，缝以下够矮且够亮才认成播放条，切掉；
    没有白缝（3.10/3.15/5.11 那种没有播放条的屏）原样返回。
    """
    x, y, w, h = box
    sub = gray[y:y + h, x:x + w]
    dark = (sub < 243).mean(axis=1)
    bright = sub.mean(axis=1)
    # 先把「≥3 行连续白」的缝全找出来。不能从底往上一路走：播放条内部也会冒出
    # 一两行近白（121a 的 Q3 就有一行 dark=0.012），当成缝就会提前收工、白切不掉。
    gaps = []
    run = 0
    for i in range(h):
        if dark[i] <= PLAYER_GAP_MAX_DARK:
            run += 1
        else:
            if run >= 3:
                gaps.append((i - run, i - 1))
            run = 0
    if run >= 3:
        gaps.append((h - run, h - 1))
    last_ink = next((i for i in range(h - 1, -1, -1) if dark[i] > PLAYER_GAP_MAX_DARK), -1)
    if last_ink < 0:
        return box
    for gs, ge in reversed(gaps):
        if ge >= last_ink:
            continue                                      # 这条缝在最后一块内容下面，是框底白边
        tail_h = last_ink - ge
        if tail_h > PLAYER_BAR_MAX_H * h:
            break                                         # 缝以下太厚，那是插图本体，不是播放条
        if float(bright[ge + 1:last_ink + 1].mean()) < PLAYER_BAR_MIN_BRIGHT:
            break                                         # 缝以下太暗，同上
        return retighten_x(gray, (x, y, w, gs))
    return box


def retighten_x(gray: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """切掉播放条之后再横向收一次。

    播放条比插图宽，连通域的 x/宽度是**按播放条算的**；只切高度会留下两条白边
    （2.2 那套的 Q4/Q5/Q7 因此裁成 912 宽，而同套其它帧只有 479）。
    """
    x, y, w, h = box
    sub = gray[y:y + h, x:x + w]
    cols = np.where((sub < 243).mean(axis=0) > 0.01)[0]
    if len(cols) == 0:
        return box
    return (x + int(cols[0]), y, int(cols[-1] - cols[0] + 1), h)


def crop_webp(img: np.ndarray, box: tuple[int, int, int, int]) -> tuple[bytes, int, int]:
    H, W = img.shape[:2]
    x, y, w, h = box
    x0, y0 = max(0, x - PAD), max(0, y - PAD)
    x1, y1 = min(W, x + w + PAD), min(H, y + h + PAD)
    im = Image.fromarray(cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2RGB))
    if im.width > MAX_WIDTH:                            # 只缩不放
        im = im.resize((MAX_WIDTH, max(1, round(im.height * MAX_WIDTH / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
    return buf.getvalue(), im.width, im.height


def decode_bytes(data: bytes) -> np.ndarray | None:
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if arr is not None:
        return arr
    try:
        with Image.open(io.BytesIO(data)) as im:
            return cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def page_screens(doc, pno: int) -> list[dict]:
    """一页 → [{png, bbox(页坐标), w, h}]，按 y 从上到下 = 屏的先后顺序。"""
    import fitz

    page = doc[pno - 1]
    out = []
    for info in sorted(page.get_image_info(xrefs=True), key=lambda i: i["bbox"][1]):
        if info.get("width", 0) < 300 or info.get("height", 0) < 120:
            continue
        try:
            pix = fitz.Pixmap(doc, info["xref"])
            if pix.alpha or pix.n > 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            out.append({"png": pix.tobytes("png"), "bbox": tuple(info["bbox"]),
                        "w": info["width"], "h": info["height"]})
        except Exception:
            continue
    return out


# ── 逐套抠图 ───────────────────────────────────────────────────────────────
def cut_first_source(rec: dict) -> dict:
    """第一来源：从口语 PDF 的每一屏里裁场景块。返回 manifest 记录（含待校验的 webp 字节）。"""
    import fitz

    out = {"set_id": rec["set_id"], "source_kind": "first", "source_file": None,
           "base": None, "frames": [], "notes": []}
    pdf, page_texts = first_source_speaking(rec["source"])
    if not pdf:
        out["skipped"] = "no_source"
        return out
    out["source_file"] = pdf
    if not page_texts:
        out["skipped"] = "no_ocr_cache"
        return out
    bank_ns = bank_question_numbers(rec["item_id"])
    # 句子号 → 真题题号。默认 1:1；scene-image-overrides.json 的 _pairing 里登记了
    # 人眼核过的错位套（3.15 / 4.20 / 5.23 —— 录入时丢了靠前的句子又连号重排）。
    pmap = ((load_overrides().get("_pairing") or {}).get(rec["set_id"]) or {}).get("map") or {}
    s2q = {int(k): int(v) for k, v in pmap.items()} or {n: n for n in bank_ns}
    want = {s2q[n] for n in bank_ns if n in s2q} & set(range(1, REPEAT_QMAX + 1))
    picked: dict[int, dict] = {}
    base_pick = None
    marks: dict[int, list[tuple]] = {}      # 页 → [(box, 标签)]，给整页预览画框用

    with fitz.open(pdf) as doc:
        for pno in range(1, doc.page_count + 1):
            text = page_texts.get(pno, "")
            if not Q_HEADER.search(text) and not is_scenario_text(text):
                continue
            screens = page_screens(doc, pno)
            if not screens:
                continue
            base_idx, frames, why = page_plan(text, len(screens))
            if why != "ok":
                out["notes"].append(f"p{pno}:{why}")
                continue
            todo = [(n, idx) for n, idx in frames.items() if n in want and n not in picked]
            if base_idx is not None and base_pick is None:
                todo.append((0, base_idx))
            for n, idx in sorted(todo):
                sc = screens[idx]
                img = decode_bytes(sc["png"])
                if img is None:
                    out["notes"].append(f"p{pno}#{idx + 1}:decode_failed")
                    continue
                box, why2 = scene_box(img)
                if box is None:
                    out["notes"].append(f"{'base' if n == 0 else 'q%d' % n}@p{pno}:{why2}")
                    continue
                hold = {"page": pno, "screen": idx + 1, "box": box, "_img": img, "_sc": sc}
                if n == 0:
                    base_pick = hold
                else:
                    picked[n] = hold

    consensus_refit(picked, out)
    for n, hold in list(picked.items()) + ([(0, base_pick)] if base_pick else []):
        img, sc, box = hold.pop("_img"), hold.pop("_sc"), hold["box"]
        webp, w, h = crop_webp(img, box)
        hold.update({"box": list(box), "w": w, "h": h, "bytes": len(webp), "_webp": webp})
        marks.setdefault(hold["page"], []).append((sc, box, "BASE" if n == 0 else f"Q{n}"))

    out["base"] = base_pick
    out["frames"] = [dict(picked[n], n=n) for n in sorted(picked)]
    out["want_questions"] = sorted(want)
    out["missing_questions"] = sorted(want - set(picked))
    out["bank_sentence_numbers"] = bank_ns
    # 前端/写库要按这张表把句子挂到帧上，不能拿文件名当句子号
    out["sentence_to_frame"] = {str(n): s2q[n] for n in bank_ns if n in s2q}
    out["pairing"] = "verified_offset" if pmap else "identity"
    out["_marks"] = marks
    return out


REFIT_TOL = 0.06        # 与共识框的相对尺寸差超过这个就重裁（1.28A 的 Q5 只差 9% 也得修）
RING = 4                # 共识框外侧这么宽的一圈必须是白的
RING_GAP = 4            # 取样前先往外让开这么多像素（避开插图自己的黑边框）
RING_WHITE_MIN = 0.92


SNAP_PAD = 0.10


def snap_box(gray: np.ndarray, box: tuple[int, int, int, int], W: int, H: int):
    """把框放宽一成，再贴着窗口里的非白像素收紧 —— 用来吸收各屏之间的缩放误差。"""
    x, y, w, h = box
    pad = int(SNAP_PAD * max(w, h))
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(W, x + w + pad), min(H, y + h + pad)
    win = gray[y0:y1, x0:x1]
    ys, xs = np.where(win < 243)
    if len(xs) == 0:
        return None
    return (x0 + int(xs.min()), y0 + int(ys.min()),
            int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))


def white_ring(gray: np.ndarray, box: tuple[int, int, int, int]) -> bool:
    """框外侧一圈是不是白的 —— 真正独立的插图四周一定留白。"""
    H, W = gray.shape[:2]
    x, y, w, h = box
    # 往外让开 RING_GAP 再取样：框边常常正好压在插图自己的黑边框上，
    # 紧贴着量会把那条边框当成「外面不白」（3.18 的整块九宫格就被误杀过）。
    g = RING_GAP
    bands = [gray[max(0, y - g - RING):max(0, y - g), x:x + w],
             gray[min(H, y + h + g):min(H, y + h + g + RING), x:x + w],
             gray[y:y + h, max(0, x - g - RING):max(0, x - g)],
             gray[y:y + h, min(W, x + w + g):min(W, x + w + g + RING)]]
    for b in bands:
        if b.size == 0:
            return False
        if float((b >= 243).mean()) < RING_WHITE_MIN:
            return False
    return True


def consensus_refit(picked: dict, out: dict) -> None:
    """用同一套里多数帧的「相对框」把少数歪掉的帧重裁一遍。

    一套七屏是同一张插图配不同高亮，插图在屏幕里的**相对位置**是同一个。
    连通域偶尔会被高亮/白缝带偏（3.18 的 Q1 只圈到中间那辆自行车，
    1.28 的 Q1 多圈了一块），这时按多数帧的相对框重裁比信那一帧自己的框稳。
    只在有 ≥3 帧时启用，重裁过的帧记 `refit: consensus`，仍然要过 Qwen 三问。
    """
    if len(picked) < 3:
        return
    # 只在「同一种截图尺寸」的那一组里算共识：2.28 的 Q1-Q3 是另一批更大、且本身
    # 被截断的截图，把它们和 Q4-Q7 混在一起算，会算出一个谁都不对的框。
    dims = {n: (h["_img"].shape[1], h["_img"].shape[0]) for n, h in picked.items()}
    # 同一批截图的像素尺寸只差个位数（1198×524 / 1196×528…），所以按「离中位数
    # 12% 以内」归组，而不是按精确相等 —— 精确相等会把每一屏都分成独立一组。
    medW = sorted(d[0] for d in dims.values())[len(dims) // 2]
    medH = sorted(d[1] for d in dims.values())[len(dims) // 2]
    members = [n for n, d in dims.items()
               if abs(d[0] - medW) <= 0.12 * medW and abs(d[1] - medH) <= 0.12 * medH]
    if len(members) < 3:
        return
    # 共识只由「主流截图尺寸」那一组算，但**重裁对所有帧开放**：1.28A 的 Q1 是另一档
    # 分辨率(1050x749)，它自己的连通域把地图右边切掉了一块，按相对比例换算过去正好能救。
    # 换算过去放不下或四周不白的，下面的 snap / 越界 / 白边三道闸照样会把它丢掉。
    foreign = [n for n in picked if n not in members]
    for n in foreign:
        out["notes"].append(f"q{n}:foreign_screen_size{dims[n]}")
    rels = []
    for n in members:
        x, y, w, hh = picked[n]["box"]
        W, H = dims[n]
        rels.append((x / W, y / H, w / W, hh / H))
    med = tuple(sorted(v[i] for v in rels)[len(rels) // 2] for i in range(4))
    drop = []
    for n, h in ((n, picked[n]) for n in sorted(picked)):
        x, y, w, hh = h["box"]
        W, H = h["_img"].shape[1], h["_img"].shape[0]
        if abs(w / W - med[2]) <= REFIT_TOL * med[2] and abs(hh / H - med[3]) <= REFIT_TOL * med[3]:
            continue
        nb = (int(round(med[0] * W)), int(round(med[1] * H)),
              int(round(med[2] * W)), int(round(med[3] * H)))
        # 各屏截图的缩放略有出入，共识框套上来往往差那么十几个像素（3.18 的九宫格
        # 底边就正好落在框外）。所以先把框放宽一成，再在这个窗口里贴着「非白像素」收紧，
        # 让它自己找到插图真正的边界。
        # 重裁失败时该丢还是该留原框？看原框是不是「只圈到插图的一小块」：
        #   面积不到共识的 6 成 = 连通域漏抓（2.28 的 Q1 只圈到一个格子），留着会是错图 → 丢；
        #   面积差不多、只是边界多了一点 = 原框本来可用（1.27A 的 Q2/Q7）→ 留原框，
        #   由尺寸闸去标记，不要因为「修不动」就把本来能看的帧扔掉。
        sub_part = (w * hh) < 0.6 * (med[2] * W) * (med[3] * H)

        def _reject(why: str):
            if sub_part:
                drop.append((n, why))
            else:
                out["notes"].append(f"q{n}:refit_rejected:{why}（留原框）")

        want_w, want_h = med[2] * W, med[3] * H
        snapped = snap_box(cv2.cvtColor(h["_img"], cv2.COLOR_BGR2GRAY), nb, W, H)
        # 收紧后要仍然贴着共识框才算成功。差超过 15% 说明窗口里混进了旁边的东西
        # （3.20 的 Q7 是整图高亮，外发光把邻块也拉进来了），那就别改了。
        if snapped is None or abs(snapped[2] - want_w) > 0.15 * want_w \
                or abs(snapped[3] - want_h) > 0.15 * want_h:
            _reject("snap_failed")
            continue
        nb = snapped
        if (nb[0] <= EDGE_MARGIN or nb[1] <= EDGE_MARGIN
                or nb[0] + nb[2] >= W - EDGE_MARGIN or nb[1] + nb[3] >= H - EDGE_MARGIN):
            # 共识框在这一屏里放不下 = 这一屏的插图本来就被截断了（2.28 的 Q1 就是
            # 半张图）。重裁会得到一张「尺寸对得上但内容缺一块」的图，本地闸再也逮不住，
            # 所以直接丢掉这一题，不出帧。
            _reject("out_of_bounds")
            continue
        if not white_ring(cv2.cvtColor(h["_img"], cv2.COLOR_BGR2GRAY), nb):
            # 共识框的四周不是白的 = 这一屏里插图并没有完整地待在这个位置
            # （2.28 的 Q1-Q3 是放大后被截断的截图，框下面还压着图的下半截）。
            # 重裁出来会是一张「尺寸对、内容缺一块」的图，尺寸闸看不出来，只能丢。
            _reject("ring_not_white")
            continue
        h["box"] = nb
        h["refit"] = "consensus"
        out["notes"].append(f"q{n}:refit_to_consensus")
    for n, why in drop:
        picked.pop(n, None)
        out["notes"].append(f"q{n}:refit_dropped:{why}")


def cut_rf(rec: dict) -> dict:
    """rf：商家 docx 里那张内嵌图本身就是底图，整张收，不再裁。"""
    out = {"set_id": rec["set_id"], "source_kind": "rf", "source_file": None,
           "base": None, "frames": [], "notes": []}
    doc, _cached, _folder, _fb = second_source_speaking(rec["set_id"])
    if not doc:
        out["skipped"] = "no_source"
        return out
    out["source_file"] = doc
    cands = [(n, sz) for n, sz, ok in docx_images(doc) if ok]
    if not cands:
        out["skipped"] = "no_source"
        out["notes"].append("docx 内没有场景图形状的内嵌图")
        return out
    if len(cands) > 1:
        out["notes"].append(f"docx 有 {len(cands)} 张候选，取第一张")
    name, size = cands[0]
    with zipfile.ZipFile(doc) as z:
        img = decode_bytes(z.read(name))
    if img is None:
        out["skipped"] = "decode_failed"
        return out
    H, W = img.shape[:2]
    webp, w, h = crop_webp(img, (0, 0, W, H))
    out["base"] = {"page": None, "screen": None, "box": [0, 0, W, H], "w": w, "h": h,
                   "bytes": len(webp), "_webp": webp, "src_image": name}
    if size < VENDOR_DRAWN_BYTES:
        out["suspect_vendor_drawn"] = True
    return out


# ── 校验 ───────────────────────────────────────────────────────────────────
OVERRIDES = os.path.join(REPO_ROOT, "data", "realBank", "scene-image-overrides.json")


def load_overrides() -> dict:
    """人工放行清单（仿 audit-overrides.json：每条必须写依据）。

    只放行「人眼核过、四件事全过」的被拦图，且**绑定裁图 sha1**：
    框一变哈希就变，放行自动失效，不会有旧结论给新图盖章。
    """
    if not os.path.exists(OVERRIDES):
        return {}
    try:
        with open(OVERRIDES, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except Exception:
        return {}


def override_entry(ov: dict, set_id: str, idx: int, webp: bytes) -> dict:
    """命中（且 sha1 对得上）的那条人工结论；没命中返回空。"""
    entry = ((ov.get(set_id) or {}).get("base" if idx == 0 else str(idx))) or {}
    if not entry:
        return {}
    if str(entry.get("sha1") or "") != hashlib.sha1(webp).hexdigest():
        return {}
    return entry


def override_hit(ov: dict, set_id: str, idx: int, webp: bytes) -> bool:
    return bool(override_entry(ov, set_id, idx, webp).get("allow"))


def verify_key(set_id: str, webp: bytes) -> str:
    """缓存键带上**裁图内容的哈希**：框一改，键就变。

    否则改了裁切逻辑重跑时，会拿上一版裁图的结论给新裁图盖章 —— 这正是
    fail-closed 最怕的静默放行。代价是重裁过的图要重新花一次钱，值。
    """
    return f"{set_id}-{hashlib.sha1(webp).hexdigest()[:8]}"


def verify_crop(webp: bytes, set_id: str, idx: int, model: str, force: bool) -> tuple[bool, list[str], bool]:
    """Qwen 三问。返回 (是否通过, 原因, 本次是否真发了请求)。"""
    set_id = verify_key(set_id, webp)
    cached = None if force else ocr_images.read_cache(VERIFY_SETKEY, set_id, idx)
    called = False
    if cached is None:
        with Image.open(io.BytesIO(webp)) as im:        # Qwen 对 webp 支持不稳，转 PNG
            buf = io.BytesIO()
            im.convert("RGB").save(buf, format="PNG")
        data, ext = ocr_images.shrink(buf.getvalue(), "png")
        cached = ocr_images.call_qwen(data, ext, model, prompt=VERIFY_PROMPT)
        called = True
        if cached.strip():
            ocr_images.write_cache(VERIFY_SETKEY, set_id, idx, cached)
    try:
        j = json.loads(ocr_images.strip_fence(cached))
    except Exception:
        return False, [f"verify_parse_failed:{str(cached)[:80]}"], called
    reasons = []
    if not j.get("is_scene"):
        reasons.append("not_scene")
    if j.get("has_ui_text"):
        reasons.append("has_ui_text")
    if j.get("has_watermark"):
        reasons.append("has_watermark")
    return (not reasons), reasons, called


def size_gate(rec: dict) -> None:
    """本地廉价闸：同一套的各帧都是同一张插图（逐句帧只多了高亮），**形状**应当一致。

    比的是长宽比不是绝对像素：引入屏的截图分辨率常与答题屏不同
    （3.15 引入屏 1153×642、答题屏 1442×902），绝对尺寸本来就对不上。
    逐句帧之间才额外比绝对尺寸 —— 它们来自同一族截图，差太多就是框歪了。
    """
    frames = list(rec.get("frames") or [])
    parts = ([rec["base"]] if rec.get("base") else []) + frames
    if len(parts) < 2:
        return
    ratios = sorted(p["w"] / float(p["h"]) for p in parts)
    med_r = ratios[len(ratios) // 2]
    for p in parts:
        if abs(p["w"] / float(p["h"]) - med_r) > SHAPE_TOL * med_r:
            p.setdefault("local_reasons", []).append(
                f"shape_mismatch:{p['w']}x{p['h']}(ratio {p['w'] / p['h']:.2f}!={med_r:.2f})")
    if len(frames) >= 2:
        mw = sorted(f["w"] for f in frames)[len(frames) // 2]
        mh = sorted(f["h"] for f in frames)[len(frames) // 2]
        for f in frames:
            # 容差是**不对称**的：比多数帧**小**说明内容被切掉了（要拦）；比多数帧**大**
            # 通常是「整图高亮」那一帧的外发光把包围盒撑开了（1.27A 的 Q2/Q7、3.20 的 Q7
            # 都是这种，图本身完好）。对称容差会把这些好帧误杀。
            if (mw - f["w"]) > SIZE_TOL * mw or (mh - f["h"]) > SIZE_TOL * mh:
                f.setdefault("local_reasons", []).append(
                    f"size_cut:{f['w']}x{f['h']}<{mw}x{mh}")
            elif (f["w"] - mw) > SIZE_GLOW_TOL * mw or (f["h"] - mh) > SIZE_GLOW_TOL * mh:
                f.setdefault("local_reasons", []).append(
                    f"size_oversize:{f['w']}x{f['h']}>{mw}x{mh}")


LOW_CONTRAST_SAT = 0.005     # 彩色像素占比低于 0.5% = 高亮在灰度源里基本看不见


def highlight_gate(rec: dict) -> None:
    """标记「高亮看不见」的套。

    真考的逐题高亮是彩色的；2.1B 那份整卷 PDF 是**灰度**扫描，高亮只剩一层淡灰，
    七张帧肉眼几乎分不出来（实测彩色像素占比 0.01%，其余套都在 1%~77%）。
    图本身没裁错，但「逐句帧」对用户没有信息量，所以单独标出来给人拍板。
    """
    frames = rec.get("frames") or []
    if not frames:
        return
    best = 0.0
    for f in frames:
        try:
            with Image.open(io.BytesIO(f["_webp"])) as im:
                a = np.asarray(im.convert("HSV"))
            best = max(best, float((a[:, :, 1] > 60).mean()))
        except Exception:
            return
    rec["max_color_ratio"] = round(best, 5)
    if best < LOW_CONTRAST_SAT:
        rec["low_contrast_highlight"] = True


# ── 整页预览（红框 + 题号） ────────────────────────────────────────────────
def annotate_pages(rec: dict) -> list[str]:
    import fitz

    marks = rec.pop("_marks", None) or {}
    if not marks or not rec.get("source_file"):
        return []
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    made = []
    z = 2.0
    with fitz.open(rec["source_file"]) as doc:
        for pno, entries in sorted(marks.items()):
            pix = doc[pno - 1].get_pixmap(matrix=fitz.Matrix(z, z))
            arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
            vis = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2BGR).copy()
            for sc, box, label in entries:
                bx0, by0, bx1, by1 = sc["bbox"]
                sx = (bx1 - bx0) / float(sc["w"])
                sy = (by1 - by0) / float(sc["h"])
                x, y, w, h = box
                p0 = (int((bx0 + x * sx) * z), int((by0 + y * sy) * z))
                p1 = (int((bx0 + (x + w) * sx) * z), int((by0 + (y + h) * sy) * z))
                cv2.rectangle(vis, p0, p1, (0, 0, 255), 2)
                cv2.putText(vis, label, (p0[0], max(14, p0[1] - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            out = os.path.join(PREVIEW_DIR, f"{rec['set_id']}__page{pno}.png")
            cv2.imwrite(out, vis)
            made.append(out)
    return made


# ── 主流程：抠图 ───────────────────────────────────────────────────────────
def select_targets(args, rows: list[dict]) -> list[dict]:
    if args.ids:
        want = {s.strip() for s in args.ids.split(",") if s.strip()}
        return [r for r in rows if r["item_id"] in want]
    if args.set:
        want = {s.strip() for s in args.set.split(",") if s.strip()}
        return [r for r in rows if r["set_id"] in want]
    return rows


def run_crop(args) -> int:
    rows = load_sets()
    targets = select_targets(args, rows)
    if not targets:
        print("没有匹配的套。", file=sys.stderr)
        return 2

    records = []
    for rec in targets:
        if rec["origin"] == "rp":
            # 一个 item 是多 Form 拼盘（句子题号能到 42），一张图对不上，本轮整类不出。
            r = {"set_id": rec["set_id"], "source_kind": "rp", "source_file": None,
                 "base": None, "frames": [], "notes": [], "skipped": "rp_multi_form"}
            if rec["set_id"] == "rp0830":
                r["notes"].append("商家自排 PDF，分步小图带满版水印（低于35元/搬运）")
            records.append(r)
            continue
        records.append(cut_first_source(rec) if rec["origin"] == "first" else cut_rf(rec))

    for r in records:
        size_gate(r)
        highlight_gate(r)

    parts = []
    for r in records:
        for part, idx in ([(r["base"], 0)] if r.get("base") else []) + \
                         [(f, f["n"]) for f in r.get("frames") or []]:
            parts.append((r, part, idx))
    need = [p for p in parts
            if args.force or ocr_images.read_cache(
                VERIFY_SETKEY, verify_key(p[0]["set_id"], p[1]["_webp"]), p[2]) is None]
    print(f"■ 目标 {len(targets)} 套 → 裁出 {len(parts)} 张"
          f"（底图 {sum(1 for r in records if r.get('base'))} / 逐句帧 {sum(len(r.get('frames') or []) for r in records)}）")
    print(f"待 Qwen 校验 {len(need)} 张（{len(parts) - len(need)} 张命中缓存），"
          f"将调用 {len(need)} 次，预计 ¥{len(need) * CNY_PER_IMAGE:.2f}")
    if args.dry_cost:
        return 0
    if len(need) > args.max_images:
        print(f"[停] 待校验 {len(need)} 张超过 --max-images {args.max_images}", file=sys.stderr)
        return 2

    os.makedirs(OUT_DIR, exist_ok=True)
    previews = []
    for r in records:
        previews += annotate_pages(r)

    ov = load_overrides()
    if not args.dry_run:
        ocr_images.load_env()
    calls = 0
    systemic = False
    for r, part, idx in parts:
        webp = part.pop("_webp")
        name = f"{r['set_id']}.webp" if idx == 0 else f"{r['set_id']}_s{idx}.webp"
        path = os.path.join(OUT_DIR, name)
        with open(path, "wb") as fh:
            fh.write(webp)
        part["file"] = path
        local = part.get("local_reasons") or []
        if args.dry_run:
            part["verified"] = None
            part["reasons"] = local + ["dry_run_not_verified"]
            continue
        if systemic:
            part["verified"] = False
            part["reasons"] = local + ["verify_aborted"]
            continue
        try:
            ok, reasons, called = verify_crop(webp, r["set_id"], idx, args.model, args.force)
        except ocr_images.SystemicFailure as e:
            print(f"\n[中止] Qwen 系统性失败：{e}", file=sys.stderr)
            systemic = True
            part["verified"] = False
            part["reasons"] = local + ["verify_systemic_failure"]
            continue
        except Exception as e:
            part["verified"] = False
            part["reasons"] = local + [f"verify_error:{str(e)[:100]}"]
            continue
        calls += 1 if called else 0
        part["verified"] = bool(ok) and not local
        part["reasons"] = local + reasons
        part["sha1"] = hashlib.sha1(webp).hexdigest()
        entry = override_entry(ov, r["set_id"], idx, webp)
        if entry.get("exclude"):
            # 人眼判定不该上（商家自绘 / 源图本身残缺）：就算 Qwen 放它过也不算数。
            part["verified"] = False
            part["excluded"] = entry["exclude"]
            part["reasons"] = (part.get("reasons") or []) + [f"excluded:{entry['exclude']}"]
        elif part["verified"]:
            part["verified_by"] = "qwen"
        elif not local and override_hit(ov, r["set_id"], idx, webp):
            # 人眼核过的误判放行（sha1 对得上才算）。本地尺寸闸不给放行 ——
            # 那一类是框真的歪了，不是判读口径问题。
            part["verified"] = True
            part["verified_by"] = "human_override"
            part["reasons"] = reasons + ["human_override"]
        flag = "✓" if part["verified"] else "✗"
        print(f"  {flag} {name}  {part['w']}x{part['h']}"
              + ("" if part["verified"] else f"  {part['reasons']}"))

    merged = {}
    if os.path.exists(MANIFEST):
        try:
            with open(MANIFEST, "r", encoding="utf-8") as fh:
                for r in (json.load(fh).get("sets") or []):
                    merged[r["set_id"]] = r
        except Exception:
            merged = {}
    for r in records:
        r.pop("_marks", None)
        merged[r["set_id"]] = r
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                   "sets": [merged[k] for k in sorted(merged)]}, fh, ensure_ascii=False, indent=2)

    okbase = sum(1 for r in records if r.get("base") and r["base"].get("verified"))
    okfull = sum(1 for r in records
                 if r.get("frames") and not r.get("missing_questions")
                 and all(f.get("verified") for f in r["frames"]))
    print(f"\n完成：底图通过 {okbase} 套 / 逐句帧齐全且全通过 {okfull} 套 / "
          f"实际 Qwen 调用 {calls} 次 ≈ ¥{calls * CNY_PER_IMAGE:.2f}")
    print(f"manifest → {MANIFEST}")
    print(f"预览 → {PREVIEW_DIR}（{len(previews)} 张）")
    return ocr_images.EXIT_SYSTEMIC if systemic else 0


# ══════════════════════════════════════════════════════════════════════════
# 复审用的 contact sheet（底图 + 全部逐句帧排成网格，每格标题号/结论/尺寸/原句）
# ══════════════════════════════════════════════════════════════════════════
REVIEW_DIR = os.path.join(OUT_DIR, "review")
CELL_W = 330
LABEL_H = 96
COLS = 4
LOW_RES_W = 300          # 裁图宽度低于这个记 low_res


def bank_sentences(item_id: str) -> dict:
    """题号 → 该句英文原文（复审时用来核「高亮物件和句子对不对得上」）。"""
    with open(BANK, "r", encoding="utf-8") as fh:
        for it in json.load(fh).get("items") or []:
            if it.get("id") != item_id:
                continue
            out = {}
            for s in it.get("sentences") or []:
                m = re.search(r"_s(\d+)$", str(s.get("id") or ""))
                if m:
                    out[int(m.group(1))] = str(s.get("sentence") or "")
            return out
    return {}


def _font(size: int):
    from PIL import ImageFont
    for p in (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\Arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def wrap(draw, text: str, font, width: int, lines: int) -> list[str]:
    out, cur = [], ""
    for word in str(text or "").split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=font) <= width:
            cur = trial
        else:
            out.append(cur)
            cur = word
            if len(out) >= lines:
                break
    if cur and len(out) < lines:
        out.append(cur)
    return out[:lines] or [""]


def contact_sheet(rec: dict, sentences: dict) -> str | None:
    from PIL import ImageDraw

    parts = ([("base", rec["base"])] if rec.get("base") else []) \
        + [(str(f["n"]), f) for f in sorted(rec.get("frames") or [], key=lambda f: f["n"])]
    parts = [(k, p) for k, p in parts if p.get("file") and os.path.exists(p["file"])]
    if not parts:
        return None
    cols = min(COLS, len(parts))
    rows = (len(parts) + cols - 1) // cols
    thumbs = []
    for k, p in parts:
        with Image.open(p["file"]) as im:
            im = im.convert("RGB")
            sc = min(1.0, (CELL_W - 12) / im.width)
            thumbs.append(im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))),
                                    Image.LANCZOS))
    cell_h = max(t.height for t in thumbs) + LABEL_H
    sheet = Image.new("RGB", (cols * CELL_W, 34 + rows * cell_h), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    f_title, f_lab, f_txt = _font(19), _font(15), _font(13)
    d.text((10, 8), f"{rec['set_id']}  [{rec['source_kind']}]  "
                    f"base={'Y' if rec.get('base') else 'MISSING'}  "
                    f"frames={[f['n'] for f in rec.get('frames') or []]}",
           fill=(0, 0, 0), font=f_title)
    for i, ((k, p), th) in enumerate(zip(parts, thumbs)):
        cx, cy = (i % cols) * CELL_W, 34 + (i // cols) * cell_h
        d.rectangle([cx + 2, cy + 2, cx + CELL_W - 4, cy + cell_h - 4], outline=(200, 200, 200))
        sheet.paste(th, (cx + 6, cy + 6))
        ty = cy + th.height + 10
        verdict = ("PASS" if p.get("verified") else "BLOCKED")
        extra = f"  {p.get('verified_by') or ''}"
        colr = (0, 130, 0) if p.get("verified") else (200, 0, 0)
        tag = "BASE" if k == "base" else f"Q{k}"
        lowres = "  LOW_RES" if p["w"] < LOW_RES_W else ""
        d.text((cx + 8, ty), f"{tag}  {verdict}{extra}  {p['w']}x{p['h']}"
                             f"  {p.get('bytes', 0) // 1024}KB{lowres}"
                             f"{'  refit' if p.get('refit') else ''}",
               fill=colr, font=f_lab)
        if not p.get("verified") and p.get("reasons"):
            d.text((cx + 8, ty + 18), ", ".join(p["reasons"])[:46], fill=(200, 0, 0), font=f_txt)
        # 标题用「真题题号」，句子要按 sentence_to_frame 反查（错位套不能直接拿题号取句子）
        q2s = {int(v): int(sk) for sk, v in (rec.get("sentence_to_frame") or {}).items()}
        sent = (sentences.get(q2s.get(int(k), int(k))) if k != "base"
                else "（引入屏底图，应当无高亮）")
        for j, line in enumerate(wrap(d, sent, f_txt, CELL_W - 18, 3)):
            d.text((cx + 8, ty + 36 + j * 15), line, fill=(40, 40, 40), font=f_txt)
    os.makedirs(REVIEW_DIR, exist_ok=True)
    out = os.path.join(REVIEW_DIR, f"{rec['set_id']}__sheet.png")
    sheet.save(out)
    return out


def run_review() -> int:
    with open(MANIFEST, "r", encoding="utf-8") as fh:
        sets = json.load(fh).get("sets") or []
    by_item = {r["set_id"]: r for r in load_sets()}
    made = []
    for r in sets:
        if r.get("skipped") or not (r.get("base") or r.get("frames")):
            continue
        item = by_item.get(r["set_id"])
        p = contact_sheet(r, bank_sentences(item["item_id"]) if item else {})
        if p:
            made.append(p)
    print(f"contact sheet {len(made)} 张 → {REVIEW_DIR}")
    for p in made:
        print("  " + os.path.basename(p))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="复述题场景插图 —— 体检 + 抠图（dry-run 阶段）")
    ap.add_argument("--survey", action="store_true", help="体检全部套：源文件/页数/命中页/录像")
    ap.add_argument("--review", action="store_true",
                    help="按 manifest 出逐套 contact sheet（底图+全部帧+题库原句），给人眼复审")
    ap.add_argument("--preview", help="体检时额外把这些 set_id 的页渲染成 PNG（逗号分隔）")
    ap.add_argument("--set", help="只抠这些 set_id（逗号分隔）")
    ap.add_argument("--ids", help="只抠这些 item id（逗号分隔）")
    ap.add_argument("--all", action="store_true", help="抠全部 50 套")
    ap.add_argument("--dry-run", action="store_true", help="只裁图 + 出预览，不调 Qwen")
    ap.add_argument("--dry-cost", action="store_true", help="只打印将调用几次 / 预计多少钱")
    ap.add_argument("--force", action="store_true", help="忽略校验缓存重跑")
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or ocr_images.DEFAULT_MODEL)
    ap.add_argument("--max-images", type=int, default=300, help="安全阀：待校验张数超过就停")
    ap.add_argument("--src", default=None, help="覆盖源根目录（默认 REALBANK_SRC）")
    args = ap.parse_args()

    if args.src:
        cm.DESKTOP_SRC = args.src

    if args.review:
        return run_review()

    if args.survey:
        rows = [survey_one(r) for r in load_sets()]
        hdr = f"{'set_id':<10} {'来源':<6} {'源文件':<34} {'页':>4} {'命中页':<22} 录像"
        print(hdr)
        print("-" * len(hdr))
        for r in rows:
            doc = str(r["doc"] or "—")
            doc = doc if len(doc) <= 34 else "…" + doc[-33:]
            hits = ",".join(str(p) for p in r["scene_pages"]) or "—"
            vids = "；".join(f"{v['file']}({v['seconds']}s)" for v in r["videos"])
            if not vids:
                vids = "；".join(f"[同日]{v['path']}({v['seconds']}s)" for v in r["videos_nearby"]) or "无"
            print(f"{r['set_id']:<10} {r['origin']:<6} {doc:<34} {r['pages']:>4} {hits:<22} {vids}")
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(SURVEY_JSON, "w", encoding="utf-8") as fh:
            json.dump({"generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                       "src": cm.DESKTOP_SRC, "sets": rows}, fh, ensure_ascii=False, indent=2)
        print(f"\nsurvey → {SURVEY_JSON}")
        if args.preview:
            want = {s.strip() for s in args.preview.split(",") if s.strip()}
            for r in rows:
                if r["set_id"] in want:
                    made = render_preview(r)
                    print(f"  预览 {r['set_id']}: " + (", ".join(os.path.basename(m) for m in made) or "无"))
        return 0

    if not (args.set or args.ids or args.all):
        print("用法：--survey，或 --set/--ids/--all 三选一", file=sys.stderr)
        return 2
    return run_crop(args)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(SURVEY_JSON, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                   "src": cm.DESKTOP_SRC, "sets": rows}, fh, ensure_ascii=False, indent=2)
    print(f"\nsurvey → {SURVEY_JSON}")

    if args.preview:
        want = {s.strip() for s in args.preview.split(",") if s.strip()}
        for r in rows:
            if r["set_id"] in want:
                made = render_preview(r)
                print(f"  预览 {r['set_id']}: " + (", ".join(os.path.basename(m) for m in made) or "无（非 PDF 源）"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
