# -*- coding: utf-8 -*-
"""真题阅读「材料框原图」—— 从源截图里把左侧材料框整块裁出来。

背景：真题阅读（data/realBank/reading/{rdl,ap}.json）是从卖家的考试界面截图里逐字 OCR
出来的**纯文本**，版面全丢了：邮件的 To/From/Subject 表头、短信的时间戳气泡、海报的
WHEN/WHERE 分栏、网页题里的柱状图（real_ap_310_1_25 的柱状图被压成 "60/50/40…" 的数字
阶梯）在文本里都不成样子。这里把材料框整块裁成图，前端直接显示原图；题干/选项仍走文本
（要点选判分），库里文本一个字不删（AI 讲解 / 错题本 / 手机端「切换文字」都还要用）。

自然分流：真题界面上 RDL 与「网页/表单类 AP」的材料在一个**带边框的矩形框**里；学术长文
AP（Floating Wind Turbines 那种）是无边框纯文本。所以规则是**检测到框才裁，检测不到就
跳过**，不按 topic/genre 猜。

三步：
  1) 定位 —— item 的文本 token 与「每张源截图的 OCR 文本」算覆盖率（≥0.6 才认），
     对应不上就 skipped:no_page，绝不猜。
  2) 裁切 —— cv2 找左半区最大的闭合矩形轮廓，外扩 6px 保留边框，输出 WebP q80 / 宽 ≤1200。
  3) 校验 —— 裁图再过一遍 Qwen3-VL OCR（复用 ocr_images.py 的 prompt/请求/缓存），
     三条都过才算 verified：含全文(≥0.90)、不含题干、不含界面水印。任一不过只记录不上传。

产物只落在 .codex-tmp/realbank/material-images/（图 + manifest.json），**绝不写回桌面源目录**，
也不改题库 —— 写库是 upload_material_images.mjs 的事。

用法:
  python scripts/realbank/crop_materials.py --set 310 --dry-run
  python scripts/realbank/crop_materials.py --set 310
  python scripts/realbank/crop_materials.py --all
  python scripts/realbank/crop_materials.py --ids real_ap_310_1_25 --force

退出码：0 正常；2 用法/输入缺失；3 Qwen 系统性失败（鉴权/余额/网络）。
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

# ocr_images.py 是同目录脚本（不是包），按路径加载，避免复制粘贴一份 Qwen 调用逻辑。
_spec = importlib.util.spec_from_file_location("rb_ocr_images", os.path.join(HERE, "ocr_images.py"))
ocr_images = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ocr_images)

BANK_DIR = os.path.join(REPO_ROOT, "data", "realBank", "reading")
OCR_CACHE = os.path.join(REPO_ROOT, ".codex-tmp", "ocr")
OUT_DIR = os.path.join(REPO_ROOT, ".codex-tmp", "realbank", "material-images")
MANIFEST = os.path.join(OUT_DIR, "manifest.json")

DESKTOP_SRC = os.environ.get("REALBANK_SRC") or r"D:\桌面\【2026改后全科真题】（持续更新中）"
CONVERTED_SRC = os.path.join(REPO_ROOT, ".codex-tmp", "realbank", "src-converted")
# 第二来源的「月份文件夹」：套题文件夹在这些目录的下一层。
MONTH_DIRS = ("4月", "5月", "6月-排版实验中有问题反馈", "7月", "8 月", "9月")

CNY_PER_IMAGE = ocr_images.CNY_PER_IMAGE  # ¥0.01/张，与 ocr_images.py 同一口径
VERIFY_CACHE_SETKEY = "material"  # 缓存键 material__<item_id>__img1.txt

MAX_WIDTH = 1200
WEBP_QUALITY = 80
PAD = 6

COVERAGE_MATCH = 0.60   # item ↔ 源截图 定位阈值
COVERAGE_VERIFY = 0.90  # 裁图 OCR 必须覆盖 item 全文的比例
STEM_PREFIX_WORDS = 6
# 界面 / 水印污染词：出现即判定切进了考试界面。若 item 正文本身含该词则不算污染
# （"Reading Room"、"Questions welcome" 这类材料自带的词不该误杀）。
CONTAMINANTS = ("闲鱼", "hide time", "question", "reading")

PAGE_MARK = re.compile(r"=====\s*PAGE\s+(\d+)\s*=====")
# 考试界面顶栏："Reading | Question 21 of 35" / "Reading1Questions11-20of35"（OCR 会粘字）
EXAM_HEADER = re.compile(r"Reading\s*[I1|/]?\s*Questions?\s*\d+\s*(?:-\s*\d+\s*)?of\s*\d+", re.I)


# ── 文本工具 ───────────────────────────────────────────────────────────────
def tokens(text: str) -> list[str]:
    """小写、去标点、长度 ≥3 的词 token（OCR 噪声下最稳的比较单位）。"""
    return [w for w in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(w) >= 3]


def coverage(item_text: str, ocr_text: str) -> float:
    """item 的词有多大比例出现在这段 OCR 文本里（集合口径，重复词不加权）。"""
    want = set(tokens(item_text))
    if not want:
        return 0.0
    have = set(tokens(ocr_text))
    return len(want & have) / len(want)


def glued_coverage(item_text: str, ocr_text: str) -> float:
    """粘字容忍版覆盖率：只用于**定位**。

    第一来源的整份 OCR 是本地引擎跑的，空格常常丢光
    （"Step1:Preparewoodenboardsforthesize…"），按词切完再比集合会把
    对得上的页判成对不上。定位阶段把两边都压成「只留字母数字」的长串，
    看 item 的词是不是作为子串出现。校验阶段仍用严格的 coverage()。
    """
    want = set(tokens(item_text))
    if not want:
        return 0.0
    hay = re.sub(r"[^a-z0-9]+", "", str(ocr_text or "").lower())
    if not hay:
        return 0.0
    return sum(1 for w in want if w in hay) / len(want)


def contains_phrase(haystack: str, phrase_tokens: list[str]) -> bool:
    """phrase_tokens 是否作为**连续**子序列出现在 haystack 的 token 流里。"""
    if not phrase_tokens:
        return False
    hay = tokens(haystack)
    n = len(phrase_tokens)
    for i in range(len(hay) - n + 1):
        if hay[i:i + n] == phrase_tokens:
            return True
    return False


def item_text_of(item: dict) -> str:
    return str(item.get("text") or item.get("passage") or "")


# ── 题库 ───────────────────────────────────────────────────────────────────
def load_bank(name: str) -> dict:
    with open(os.path.join(BANK_DIR, f"{name}.json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


def all_items() -> list[tuple[str, dict]]:
    out = []
    for kind in ("rdl", "ap"):
        for it in load_bank(kind).get("items") or []:
            out.append((kind, it))
    return out


# ── 源定位 ─────────────────────────────────────────────────────────────────
def set_key_of(item: dict) -> str:
    """item.id 里的套 key：real_rdl_<setkey>_1_21 / real_ap_<setkey>_2001_200101。"""
    m = re.match(r"^real_(?:rdl|ap)_(.+?)_\d+_\d+$", str(item.get("id") or ""))
    return m.group(1) if m else ""


def _month_folders() -> list[str]:
    out = []
    for md in MONTH_DIRS:
        root = os.path.join(DESKTOP_SRC, md)
        if not os.path.isdir(root):
            continue
        for leaf in sorted(os.listdir(root)):
            p = os.path.join(root, leaf)
            if os.path.isdir(p):
                out.append(p)
    return out


_FOLDER_CACHE: dict | None = None


def second_source_folder(setkey: str) -> str | None:
    """rf0615 / rp0822 → 月份文件夹里的套题目录。

    setkey 的算法**直接复用 ocr_images.setkey_for**（同一套 rf/rp 前缀口径），
    这里只是把它反过来建一张索引；同一天既有线下卷又有普通卷时，rp 认「线下」那份。
    """
    global _FOLDER_CACHE
    if _FOLDER_CACHE is None:
        _FOLDER_CACHE = {}
        for folder in _month_folders():
            for prefix in ("rf", "rp"):
                try:
                    key = ocr_images.setkey_for(folder, prefix)
                except ValueError:
                    continue
                offline = "线下" in os.path.basename(folder)
                prefer = offline if prefix == "rp" else not offline
                if key not in _FOLDER_CACHE or (prefer and not _FOLDER_CACHE[key][1]):
                    _FOLDER_CACHE[key] = (folder, prefer)
    hit = _FOLDER_CACHE.get(setkey)
    return hit[0] if hit else None


SECTION_WORDS = ("阅读", "写作", "口语", "听力")
NOT_QUESTION_PAPER = re.compile(r"答案|原文|参考|answer|script", re.I)


def first_source_pdf(source: str) -> str | None:
    """第一来源套名（"3.10新托福真题" / "5.10新托福真题_v2"）→ 阅读题面 PDF。

    两种目录形态：分科的（`3.10 阅读.pdf`）和整卷一份的（1 月的
    `新托福真题01.pdf` 一份装下四科）。前者认「阅读」，后者认「排除答案/听力原文
    之后剩下的那份主文档」—— 整卷 PDF 里混着别科的截图不影响，定位本来就靠覆盖率。
    """
    for root in (CONVERTED_SRC, DESKTOP_SRC):
        folder = os.path.join(root, source)
        if not os.path.isdir(folder):
            continue
        cand = [fn for fn in sorted(os.listdir(folder))
                if fn.lower().endswith(".pdf") and not fn.startswith("~$")
                and not NOT_QUESTION_PAPER.search(fn)]
        if not cand:
            continue
        named = [fn for fn in cand if any(w in fn for w in SECTION_WORDS)]
        if named:
            hit = next((fn for fn in named if "阅读" in fn), None)
            return os.path.join(folder, hit) if hit else None
        pick = max(cand, key=lambda fn: os.path.getsize(os.path.join(folder, fn)))
        return os.path.join(folder, pick)
    return None


def first_source_ocr(source: str, pdf_path: str) -> dict[int, str]:
    """第一来源的整份 OCR（`===== PAGE N =====` 分页）→ {页码: 文本}。

    缓存文件名口径固定为 `<套名>__<pdf 去扩展名>.txt`，和选中的 PDF 严格配对，
    免得同一套里的「阅读」与「听力」缓存被张冠李戴。
    """
    stem = os.path.splitext(os.path.basename(pdf_path))[0]
    path = os.path.join(OCR_CACHE, f"{source}__{stem}.txt")
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    parts = PAGE_MARK.split(raw)
    out: dict[int, str] = {}
    for i in range(1, len(parts) - 1, 2):
        out[int(parts[i])] = parts[i + 1]
    return out


def second_source_reading(setkey: str) -> tuple[str | None, dict[int, str]]:
    """第二来源 → (Reading 文档路径, {图序/页序: 缓存 OCR 文本})。"""
    folder = second_source_folder(setkey)
    if not folder:
        return None, {}
    for fn in sorted(os.listdir(folder)):
        if fn.startswith("~$") or not re.search(r"reading", fn, re.I):
            continue
        if not (fn.lower().endswith(".docx") or fn.lower().endswith(".pdf")):
            continue
        base = ocr_images.cache_base(fn)
        return os.path.join(folder, fn), ocr_images.cached_texts(setkey, base)
    return None, {}


# ── 源截图（unit）枚举 ─────────────────────────────────────────────────────
MIN_UNIT_W, MIN_UNIT_H = 400, 150


def pdf_units(path: str) -> dict[int, list[dict]]:
    """PDF → {页码: [该页的大图，按 y 从上到下]}，每张大图 = 一张源截图。"""
    import fitz

    out: dict[int, list[dict]] = {}
    with fitz.open(path) as doc:
        for pno, page in enumerate(doc, start=1):
            infos = [i for i in page.get_image_info(xrefs=True)
                     if i.get("width", 0) >= MIN_UNIT_W and i.get("height", 0) >= MIN_UNIT_H]
            infos.sort(key=lambda i: i["bbox"][1])
            items = []
            for info in infos:
                try:
                    pix = fitz.Pixmap(doc, info["xref"])
                    if pix.alpha or pix.n > 3:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    items.append({"png": pix.tobytes("png"), "page": pno})
                except Exception:
                    continue
            if items:
                out[pno] = items
    return out


def docx_units(path: str) -> dict[int, bytes]:
    """docx → {内嵌图序号(1 起): 原始字节}，序号与 ocr_images 的缓存键一致。"""
    out: dict[int, bytes] = {}
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.startswith("word/media/")]

        def sort_key(n: str):
            m = re.search(r"(\d+)", os.path.basename(n))
            return (int(m.group(1)) if m else 0, n)

        for i, n in enumerate(sorted(names, key=sort_key), start=1):
            out[i] = z.read(n)
    return out


def split_page_segments(page_text: str) -> list[str]:
    """把一页 OCR 文本按考试界面顶栏切成「每张截图一段」。"""
    marks = [m.start() for m in EXAM_HEADER.finditer(page_text)]
    if not marks:
        return []
    marks.append(len(page_text))
    return [page_text[marks[i]:marks[i + 1]] for i in range(len(marks) - 1)]


def build_units(source: str, setkey: str) -> tuple[list[dict], str]:
    """这套卷的全部源截图候选。返回 ([unit...], 源描述)。

    unit = {img: bytes(png/原图), text: 该截图的 OCR 文本, ref: 人读的定位串, page: 页/图序}
    定位只用 unit.text，所以「一页有几张截图」必须和「OCR 分了几段」严格对齐，
    对不齐就整页作废（宁可 no_page 也不能张冠李戴）。
    """
    units: list[dict] = []
    pdf = first_source_pdf(source) if source else None
    if pdf:
        page_texts = first_source_ocr(source, pdf)
        by_page = pdf_units(pdf)
        for pno, imgs in sorted(by_page.items()):
            text = page_texts.get(pno, "")
            segs = split_page_segments(text)
            if len(segs) == len(imgs):
                per = segs
            elif len(imgs) == 1:
                per = [text]
            else:
                continue  # 对不齐 → 整页作废
            for k, (img, t) in enumerate(zip(imgs, per), start=1):
                units.append({"img": img["png"], "text": t, "page": pno,
                              "ref": f"{os.path.basename(pdf)} p{pno} #{k}"})
        return units, pdf

    doc, cached = second_source_reading(setkey)
    if not doc:
        return [], ""
    if doc.lower().endswith(".pdf"):
        by_page = pdf_units(doc)
        for pno, imgs in sorted(by_page.items()):
            if len(imgs) != 1:
                continue
            units.append({"img": imgs[0]["png"], "text": cached.get(pno, ""), "page": pno,
                          "ref": f"{os.path.basename(doc)} p{pno}"})
    else:
        for idx, data in sorted(docx_units(doc).items()):
            units.append({"img": data, "text": cached.get(idx, ""), "page": idx,
                          "ref": f"{os.path.basename(doc)} img{idx}"})
    return units, doc


# ── 裁切 ───────────────────────────────────────────────────────────────────
def decode(img_bytes: bytes) -> np.ndarray | None:
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is not None:
        return img
    try:  # cv2 不认的格式（wmf/emf/…）走 Pillow
        im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def is_exam_shot(unit_text: str) -> bool:
    """这张截图是不是「整块考试界面」（有顶栏 + 右侧题目栏）。

    第二来源商家重排过的材料图没有界面，整张就是材料本身；两者的裁切约束不一样。
    判据取自 OCR 文本而不是来源目录 —— 来源会变，界面顶栏不会。
    """
    return bool(EXAM_HEADER.search(unit_text or ""))


def _quads(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    out = []
    binaries = [
        cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                              cv2.THRESH_BINARY_INV, 31, 10),
        cv2.dilate(cv2.Canny(gray, 40, 120), np.ones((3, 3), np.uint8), iterations=1),
    ]
    for b in binaries:
        cnts, _ = cv2.findContours(b, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            peri = cv2.arcLength(c, True)
            if peri < 200:
                continue
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) != 4 or not cv2.isContourConvex(approx):
                continue
            x, y, w, h = cv2.boundingRect(approx)
            out.append((x, y, w, h))
    return out


FILL_RATIO_MIN = 0.85   # 兜底分支：轮廓填满其 boundingRect 的比例（矩形块才会接近 1）
FALLBACK_AREA_MIN = 0.06
FALLBACK_RATIO = (0.3, 4.0)


def _rect_blobs(img: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    """轮廓的 boundingRect + 填充率（contourArea / (w*h)）。

    approxPolyDP 的四边形筛选会漏掉两类框：圆角卡片（顶点被多打成 6~8 点）、
    被深色标题条切成两段的边框。这类轮廓虽然不是「四点凸多边形」，但仍然
    **填满**自己的 boundingRect —— 用填充率把矩形块和文字/图标区分开。
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    out = []
    binaries = [
        cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                              cv2.THRESH_BINARY_INV, 31, 10),
        cv2.dilate(cv2.Canny(gray, 40, 120), np.ones((3, 3), np.uint8), iterations=1),
    ]
    for b in binaries:
        cnts, _ = cv2.findContours(b, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            if cv2.arcLength(c, True) < 200:
                continue
            x, y, w, h = cv2.boundingRect(c)
            if w <= 0 or h <= 0:
                continue
            fill = float(cv2.contourArea(c)) / float(w * h)
            if fill < FILL_RATIO_MIN:
                continue
            out.append((x, y, w, h, fill))
    return out


def find_box_loose(img: np.ndarray, exam: bool) -> tuple[int, int, int, int] | None:
    """兜底框检测：**只在 find_box 返回 None 时调用**，绝不参与已通过条目的判定。

    与 find_box 的差别只有两点：用填充率代替四边形筛选；对 exam_shot=False 的
    「商家重排全宽卡片」把面积下限从 30% 降到 6%、不再要求框占满画面
    （9.02 那张圆角卡片只占页面 22%，A4 下半页全是白）。
    考试界面截图这一支的左半区约束原样保留 —— 那里切歪就会吃进右侧题目栏。
    """
    H, W = img.shape[:2]
    page_area = float(H * W)
    best = None
    for (x, y, w, h, _fill) in _rect_blobs(img):
        area = float(w * h)
        if area < FALLBACK_AREA_MIN * page_area:
            continue
        ratio = w / float(h)
        if not (FALLBACK_RATIO[0] <= ratio <= FALLBACK_RATIO[1]):
            continue
        if exam and (y < 0.08 * H or x > 0.55 * W or (x + w) > 0.68 * W):
            continue
        if best is None or area > best[0]:
            best = (area, (x, y, w, h))
    return best[1] if best else None


def find_box(img: np.ndarray, exam: bool) -> tuple[tuple[int, int, int, int] | None, str]:
    """找材料框。返回 ((x,y,w,h), 说明) 或 (None, 原因)。"""
    H, W = img.shape[:2]
    page_area = float(H * W)
    best = None
    for (x, y, w, h) in _quads(img):
        area = float(w * h)
        if w < 0.12 * W or h < 0.04 * H:
            continue
        ratio = w / float(h)
        if not (0.15 <= ratio <= 6.0):
            continue
        if exam:
            # 考试界面：材料框在左半区，右边界不得越过 68%（越过就是切进了题目栏）
            if area < 0.06 * page_area:
                continue
            if y < 0.08 * H or x > 0.55 * W or (x + w) > 0.68 * W:
                continue
        else:
            # 材料图：整张就是材料，框（海报边/手机壳）通常占满画面
            if area < 0.30 * page_area:
                continue
        if best is None or area > best[0]:
            best = (area, (x, y, w, h))
    if best:
        return best[1], "box"
    return None, "no_box"


def trim_white(img: np.ndarray) -> tuple[int, int, int, int] | None:
    """去掉四周纯白留白后的 bbox（只给「无框材料图」当兜底）。"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = gray < 245
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


def crop_to_webp(img: np.ndarray, box: tuple[int, int, int, int]) -> tuple[bytes, int, int]:
    H, W = img.shape[:2]
    x, y, w, h = box
    x0, y0 = max(0, x - PAD), max(0, y - PAD)
    x1, y1 = min(W, x + w + PAD), min(H, y + h + PAD)
    crop = img[y0:y1, x0:x1]
    im = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    if im.width > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, max(1, round(im.height * MAX_WIDTH / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
    return buf.getvalue(), im.width, im.height


# ── 校验 ───────────────────────────────────────────────────────────────────
def verify(item: dict, crop_ocr: str) -> tuple[bool, list[str]]:
    """fail-closed 三连：含全文 / 不含题干 / 不含界面水印。"""
    reasons = []
    body = item_text_of(item)
    cov = coverage(body, crop_ocr)
    if cov < COVERAGE_VERIFY:
        reasons.append(f"text_coverage={cov:.2f}<{COVERAGE_VERIFY}")
    for q in item.get("questions") or []:
        pref = tokens(q.get("stem") or "")[:STEM_PREFIX_WORDS]
        if len(pref) >= 3 and contains_phrase(crop_ocr, pref):
            reasons.append(f"contains_stem:{' '.join(pref)}")
            break
    low = (crop_ocr or "").lower()
    body_low = body.lower()
    for bad in CONTAMINANTS:
        if bad in low and bad not in body_low:
            reasons.append(f"contaminated:{bad}")
            break
    return (not reasons), reasons


def clean_material(item: dict, unit_text: str) -> bool:
    """这张源截图本身是不是「只有材料」（可以整张当裁图用）。

    判据和最终校验的第 2、3 条一模一样，只是作用在**源截图的 OCR** 上：
    既没有题干也没有界面字样 = 这张图里根本没有右栏可切进去。
    """
    if is_exam_shot(unit_text):
        return False
    _, reasons = verify(item, unit_text)
    return not any(r.startswith(("contains_stem", "contaminated")) for r in reasons)


def ocr_crop(webp_bytes: bytes, item_id: str, model: str, force: bool) -> str:
    """裁图转写。缓存键 material__<item_id>__img1（命中零调用）。"""
    if not force:
        cached = ocr_images.read_cache(VERIFY_CACHE_SETKEY, item_id, 1)
        if cached is not None:
            return cached
    # Qwen 端点对 webp 支持不稳，统一转 PNG 再发（转写质量不受影响）。
    im = Image.open(io.BytesIO(webp_bytes)).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    data, ext = ocr_images.shrink(buf.getvalue(), "png")
    text = ocr_images.call_qwen(data, ext, model)
    if text.strip():
        ocr_images.write_cache(VERIFY_CACHE_SETKEY, item_id, 1, text)
    return text


# ── 主流程 ─────────────────────────────────────────────────────────────────
def self_check() -> int:
    """纯函数自测（`--self-check`）：覆盖率、题干排除、污染判定、页面分段。

    这几个函数是 fail-closed 的判据本体，判错一次就会把切歪的图塞进库，
    所以每次改它们都该先跑这个（零 token、零网络）。
    """
    body = "Build a Raised Garden Bed. Prepare wooden boards for the size."
    assert coverage(body, body) == 1.0
    assert coverage(body, "totally unrelated words here") < 0.2
    # 本地 OCR 常把空格吃掉；定位口径必须还认得出来，严格口径则不认。
    glued = "BuildaRaisedGardenBed.Preparewoodenboardsforthesize."
    assert glued_coverage(body, glued) == 1.0
    assert coverage(body, glued) < 0.5

    item = {
        "text": body,
        "questions": [{"stem": "Why would someone follow these instructions?"}],
    }
    ok, why = verify(item, body)
    assert ok, why
    # 切进右栏 → 题干前 6 个词出现在裁图里
    ok, why = verify(item, body + " Why would someone follow these instructions?")
    assert not ok and any(r.startswith("contains_stem") for r in why), why
    # 界面/水印字样
    ok, why = verify(item, body + " Hide Time")
    assert not ok and any(r.startswith("contaminated") for r in why), why
    # 材料自带的词不算污染：item 正文里本来就有 "question" 就不该误杀
    it2 = {"text": body + " Questions welcome.", "questions": []}
    ok, _ = verify(it2, body + " Questions welcome.")
    assert ok
    # 覆盖不全 → 不过
    ok, why = verify(item, "Build a Raised")
    assert not ok and any(r.startswith("text_coverage") for r in why), why

    assert contains_phrase("alpha beta gamma delta", ["beta", "gamma"])
    assert not contains_phrase("alpha beta gamma delta", ["beta", "delta"])

    page = ("Reading | Question 21 of 35 00:14:18 Hide\nfirst screen\n"
            "Reading1Questions22-23of35 00:12:00 Hide\nsecond screen")
    segs = split_page_segments(page)
    assert len(segs) == 2, segs
    assert "first screen" in segs[0] and "second screen" in segs[1]
    assert split_page_segments("no header at all") == []
    assert is_exam_shot(page) and not is_exam_shot("Messages\nElena Rowe (4:44 P.M.)")

    # 兜底框检测：造一张 800x1000 白图，画一个圆角深框（approxPolyDP 不会给 4 点），
    # 面积 ~24% —— 严格支(find_box, exam=False 要求 ≥30%)必须放过，兜底支必须逮住。
    def _round_rect(dst, x0, y0, x1, y1, color, r=26):
        cv2.rectangle(dst, (x0 + r, y0), (x1 - r, y1), color, -1)
        cv2.rectangle(dst, (x0, y0 + r), (x1, y1 - r), color, -1)
        for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
            cv2.circle(dst, (cx, cy), r, color, -1)

    canvas = np.full((1000, 800, 3), 255, np.uint8)
    _round_rect(canvas, 100, 150, 700, 470, (30, 30, 30))          # 圆角卡片外框
    _round_rect(canvas, 104, 154, 696, 466, (255, 255, 255), 22)   # 掏空成描边
    cv2.rectangle(canvas, (104, 154), (696, 210), (60, 90, 95), -1)  # 深色标题条
    assert find_box(canvas, False)[0] is None, "严格支不该在此改变行为"
    loose = find_box_loose(canvas, False)
    assert loose is not None, "兜底支应逮住圆角卡片"
    lx, ly, lw, lh = loose
    assert abs(lx - 100) <= 8 and abs(ly - 150) <= 8, loose
    assert abs(lw - 600) <= 16 and abs(lh - 320) <= 16, loose
    # 纯白图里没有任何块 → 兜底支必须也返回 None（不许无中生有）
    assert find_box_loose(np.full((1000, 800, 3), 255, np.uint8), False) is None

    print("self-check ok")
    return 0


def select_items(args) -> list[tuple[str, dict]]:
    items = all_items()
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",") if s.strip()}
        return [(k, it) for k, it in items if it.get("id") in wanted]
    if args.set:
        keys = {s.strip() for s in args.set.split(",") if s.strip()}
        return [(k, it) for k, it in items if set_key_of(it) in keys]
    return items


def main() -> int:
    ap = argparse.ArgumentParser(description="真题阅读材料框裁图 + fail-closed 校验")
    ap.add_argument("--set", help="只处理这些套 key（逗号分隔，如 310,rf0615）")
    ap.add_argument("--ids", help="只处理这些 item id（逗号分隔）")
    ap.add_argument("--all", action="store_true", help="处理 rdl + ap 全部 item")
    ap.add_argument("--dry-run", action="store_true", help="只做定位与裁切演算，不写文件、不调 Qwen")
    ap.add_argument("--force", action="store_true", help="忽略裁图 OCR 缓存重新校验")
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or ocr_images.DEFAULT_MODEL)
    ap.add_argument("--max-images", type=int, default=200, help="安全阀：待 OCR 张数超过就停")
    ap.add_argument("--self-check", action="store_true", help="只跑纯函数自测（零网络）")
    ap.add_argument("--src", default=None,
                    help="覆盖源根目录（默认桌面路径，也可用 REALBANK_SRC 环境变量）")
    args = ap.parse_args()

    global DESKTOP_SRC
    if args.src:
        DESKTOP_SRC = args.src

    if args.self_check:
        return self_check()

    if not (args.set or args.ids or args.all):
        print("用法：--set <key> / --ids <a,b> / --all 三选一", file=sys.stderr)
        return 2

    ocr_images.load_env()
    targets = select_items(args)
    if not targets:
        print("没有匹配的 item。", file=sys.stderr)
        return 2

    # 按套分组，一套只解析一次源文档。
    by_set: dict[str, list[tuple[str, dict]]] = {}
    for kind, it in targets:
        by_set.setdefault(set_key_of(it), []).append((kind, it))

    records: list[dict] = []
    pending: list[dict] = []  # 裁出来了、等着 OCR 校验的

    for setkey, group in sorted(by_set.items()):
        source = str(group[0][1].get("source") or "")
        units, src_desc = build_units(source, setkey)
        if not units:
            for kind, it in group:
                records.append({"item_id": it["id"], "kind": kind, "set": setkey, "source": source,
                                "skipped": "no_source", "note": "找不到源截图或其 OCR 缓存"})
            continue

        used_pages: set[int] = set()
        for kind, it in group:
            body = item_text_of(it)
            scored = sorted(((glued_coverage(body, u["text"]), u) for u in units),
                            key=lambda p: p[0], reverse=True)
            top_cov = scored[0][0]
            # 同一份材料常连着 2~3 屏重复出现（每题一屏），覆盖率几乎一样 —— 取最靠前那屏。
            near = [u for c, u in scored if c >= top_cov - 0.02]
            unit = min(near, key=lambda u: u["page"])
            if top_cov < COVERAGE_MATCH:
                records.append({"item_id": it["id"], "kind": kind, "set": setkey, "source": source,
                                "skipped": "no_page", "match_coverage": round(top_cov, 3)})
                continue
            img = decode(unit["img"])
            if img is None:
                records.append({"item_id": it["id"], "kind": kind, "set": setkey, "source": source,
                                "skipped": "decode_failed", "ref": unit["ref"]})
                continue
            exam = is_exam_shot(unit["text"])
            box, why = find_box(img, exam)
            if box is None:
                # 四边形筛选没找到 → 用「填满 boundingRect 的轮廓」再试一次。
                loose = find_box_loose(img, exam)
                if loose is not None:
                    box, why = loose, "box_loose"
            if box is None and kind == "rdl" and clean_material(it, unit["text"]):
                # 商家重排过的 RDL 材料图整张就是材料（既没有考试界面顶栏，OCR 里
                # 也不含任何题干/界面字样），没有「切进右栏」的风险，去白边即可。
                # AP 不给这条兜底 —— 学术长文必须靠「有框」才裁。
                box = trim_white(img)
                why = "trim" if box else "no_box"
            if box is None:
                records.append({"item_id": it["id"], "kind": kind, "set": setkey, "source": source,
                                "skipped": "no_box", "ref": unit["ref"],
                                "match_coverage": round(top_cov, 3)})
                continue
            webp, w, h = crop_to_webp(img, box)
            used_pages.add(unit["page"])
            pending.append({
                "item_id": it["id"], "kind": kind, "set": setkey, "source": source,
                "src": os.path.basename(src_desc), "ref": unit["ref"], "page": unit["page"],
                "bbox": [int(v) for v in box], "mode": why, "exam_shot": exam,
                "match_coverage": round(top_cov, 3), "w": w, "h": h, "bytes": len(webp),
                "webp": webp, "item": it,
            })

    need_ocr = [p for p in pending
                if args.force or ocr_images.read_cache(VERIFY_CACHE_SETKEY, p["item_id"], 1) is None]
    print(f"■ 目标 item {len(targets)} 条 → 裁到框 {len(pending)} 条，跳过 {len(records)} 条")
    print(f"待 OCR 校验 {len(need_ocr)} 张（{len(pending) - len(need_ocr)} 张命中缓存），"
          f"预计费用 ¥{len(need_ocr) * CNY_PER_IMAGE:.2f}（按 ¥{CNY_PER_IMAGE}/张估）")
    if args.dry_run:
        for p in pending:
            print(f"  · {p['item_id']}  {p['ref']}  bbox={p['bbox']}  {p['w']}x{p['h']}  {p['bytes']/1024:.0f}KB  [{p['mode']}]")
        for r in records:
            print(f"  × {r['item_id']}  {r.get('skipped')}  {r.get('match_coverage', '')}")
        print("（--dry-run，未写任何文件、未发任何请求）")
        return 0
    if len(need_ocr) > args.max_images:
        print(f"[停] 待 OCR {len(need_ocr)} 张超过 --max-images {args.max_images}", file=sys.stderr)
        return 2

    os.makedirs(OUT_DIR, exist_ok=True)
    calls = 0
    systemic = False
    for i, p in enumerate(pending, start=1):
        item = p.pop("item")
        webp = p.pop("webp")
        path = os.path.join(OUT_DIR, f"{p['item_id']}.webp")
        with open(path, "wb") as fh:
            fh.write(webp)
        p["file"] = path
        if systemic:
            p["verified"] = False
            p["verify_failed"] = ["ocr_aborted"]
            records.append(p)
            continue
        cached_before = ocr_images.read_cache(VERIFY_CACHE_SETKEY, p["item_id"], 1)
        try:
            text = ocr_crop(webp, p["item_id"], args.model, args.force)
            if cached_before is None or args.force:
                calls += 1
        except ocr_images.SystemicFailure as e:
            print(f"\n[中止] Qwen 系统性失败：{e}", file=sys.stderr)
            systemic = True
            p["verified"] = False
            p["verify_failed"] = ["ocr_systemic_failure"]
            records.append(p)
            continue
        except Exception as e:
            p["verified"] = False
            p["verify_failed"] = [f"ocr_error:{str(e)[:120]}"]
            records.append(p)
            continue
        ok, reasons = verify(item, text)
        p["verified"] = ok
        p["verify_coverage"] = round(coverage(item_text_of(item), text), 3)
        if not ok:
            p["verify_failed"] = reasons
        records.append(p)
        flag = "✓" if ok else "✗"
        print(f"  [{i}/{len(pending)}] {flag} {p['item_id']}  cov={p['verify_coverage']}"
              + ("" if ok else f"  {reasons}"))

    # 增量跑（--ids / --set）只该覆盖本次处理过的 item，其余记录原样留着，
    # 否则一次 --ids 就会把上一轮全量跑的 manifest 抹成一条。
    run_ids = {r["item_id"] for r in records}
    merged: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        try:
            with open(MANIFEST, "r", encoding="utf-8") as fh:
                for r in (json.load(fh).get("records") or []):
                    merged[r["item_id"]] = r
        except Exception:
            merged = {}
    for r in records:
        merged[r["item_id"]] = r
    records = sorted(merged.values(), key=lambda r: r["item_id"])
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                   "records": records}, fh, ensure_ascii=False, indent=2)

    okc = sum(1 for r in records if r.get("verified") and r["item_id"] in run_ids)
    print(f"\n完成：verified {okc} / 裁到框 {len(pending)} / 目标 {len(targets)}，"
          f"实际 OCR {calls} 张 ≈ ¥{calls * CNY_PER_IMAGE:.2f}")
    print(f"manifest → {MANIFEST}")
    return ocr_images.EXIT_SYSTEMIC if systemic else 0


if __name__ == "__main__":
    sys.exit(main())
