# -*- coding: utf-8 -*-
"""
真题录入（重排版格式）—— 图片逐字转写。

第二来源（商家「重排版」docx）里有两类内容只以截图形式存在：
  1. **Answers 文档**：8 套里有 6 套的答案页整份是 7~10 张截图（另外 2 套是纯文本）；
  2. **Reading 的 RDL 材料**：海报/通知/日程这类日常阅读材料，部分套是截图（另一部分在表格里是文字）。

这两类都必须先转成文字，parse_reformatted.py 才能确定性地解析。用通义千问 Qwen3-VL
（DASHSCOPE_API_KEY，OpenAI 兼容接口，与 lib/ai/qwenVision.js 同一个端点/模型）做**逐字转写**，
prompt 里明令「不解释、不翻译、不补写」——这里要的是 OCR，不是理解。

三条规矩：
  · **磁盘缓存**：`.codex-tmp/ocr/<setkey>__<docx名>__img<N>.txt`。命中缓存零调用，
    所以重跑解析器不花钱、结果可复现。
  · **先报数**：`--dry-run` 只打印将要调用几张；真跑前也先打印张数与预计费用（¥0.01/张估）。
  · **只写缓存**：本脚本不产出题库，产物只有缓存文本；解析器只读缓存、绝不联网。

用法:
  python scripts/realbank/ocr_images.py "<套题文件夹>" --dry-run
  python scripts/realbank/ocr_images.py "<套题文件夹>"            # 真跑（先打印张数与预估费用）
  python scripts/realbank/ocr_images.py "<套题文件夹>" --only Answers   # 只转写某个 docx
  python scripts/realbank/ocr_images.py "<套题文件夹>" --force          # 忽略缓存重跑

退出码：0 正常；2 用法/输入缺失；3 API 系统性失败（鉴权/余额/网络）。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DIR = os.path.join(REPO_ROOT, ".codex-tmp", "ocr")
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen3-vl-plus"
# 估价口径：Qwen3-VL 大陆区一张 A4 截图 ≈ 1.5k~3k 视觉 token + 千把输出 token，
# 折下来一张一分钱量级。只用于「跑之前让人看见要花多少」，不是账单。
CNY_PER_IMAGE = 0.01

EXIT_SYSTEMIC = 3

TRANSCRIBE_PROMPT = """你是逐字转写器（OCR）。把图片里的文字**原样**转写成纯文本。

铁律：
- 只转写你真实看到的字符，不解释、不翻译、不总结、不补写、不纠错。
- 保持原有的行结构与阅读顺序：标题一行，列表每项一行，答案清单里每个「题号 答案」保持原样。
- 表格按行转写，同一行的单元格之间用 " | " 分隔。
- 图标、装饰、页眉页脚的页码/水印一律略去。
- 看不清的字符写成 ?，不要猜。
- 直接输出转写结果本身，不要任何前言、说明或 markdown 代码围栏。"""


# ── env ────────────────────────────────────────────────────────────────────
def load_env() -> None:
    for name in (".env.local", ".env"):
        p = os.path.join(REPO_ROOT, name)
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    m = re.match(r"^\s*(\w+)\s*=\s*(.*)$", line)
                    if m and not os.environ.get(m.group(1)):
                        os.environ[m.group(1)] = m.group(2).strip().strip("'\"")
        except OSError:
            pass


# ── docx 图片抽取 ──────────────────────────────────────────────────────────
def docx_images(path: str) -> list[tuple[int, bytes, str]]:
    """按 word/media 里的自然序返回 [(序号1起, 原始字节, 扩展名)]。

    序号刻意用「media 目录里的排序序号」而不是段落里的锚点序号：缓存键要在
    解析器和本脚本之间稳定对齐，而 media 名（image1/image2/…）是 docx 里唯一
    不随段落解析实现变化的东西。
    """
    out: list[tuple[int, bytes, str]] = []
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.startswith("word/media/")]

        def sort_key(n: str):
            m = re.search(r"(\d+)", os.path.basename(n))
            return (int(m.group(1)) if m else 0, n)

        for i, n in enumerate(sorted(names, key=sort_key), start=1):
            ext = os.path.splitext(n)[1].lower().lstrip(".") or "png"
            out.append((i, z.read(n), ext))
    return out


def pdf_page_images(path: str, dpi: int = 150) -> list[tuple[int, bytes, str]]:
    """图片版 PDF → 逐页 PNG 字节，序号 1 起（页序即阅读序）。

    第二波源料里有一大类「完整卷但整份退回截图」——Answers/Reading/Listening 是
    没有文字层的 PDF。渲染成图再走同一条 Qwen-VL 转写通道，缓存键与 docx 图一致，
    所以下游解析器不需要知道这份文字是从 docx 还是 PDF 来的。
    """
    import fitz  # PyMuPDF（延迟导入：没有 PDF 的场景不该因为缺库而崩）

    out: list[tuple[int, bytes, str]] = []
    with fitz.open(path) as doc:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(dpi=dpi)
            out.append((i, pix.tobytes("png"), "png"))
    return out


def pdf_text_words(path: str) -> int:
    """PDF 文字层的词数。0（或极少）= 整份是截图，必须 OCR。"""
    try:
        import fitz
    except Exception:
        return 0
    try:
        with fitz.open(path) as doc:
            return sum(len(p.get_text().split()) for p in doc)
    except Exception:
        return 0


def source_images(path: str) -> list[tuple[int, bytes, str]]:
    """按扩展名分派：docx 取内嵌图，pdf 取逐页渲染图。"""
    return pdf_page_images(path) if path.lower().endswith(".pdf") else docx_images(path)


def source_image_count(path: str) -> int:
    """这份文档一共有几张待转写的图（docx 内嵌图数 / PDF 页数）。不渲染，只数数。"""
    if path.lower().endswith(".pdf"):
        try:
            import fitz
            with fitz.open(path) as doc:
                return len(doc)
        except Exception:
            return 0
    try:
        with zipfile.ZipFile(path) as z:
            return len([n for n in z.namelist() if n.startswith("word/media/")])
    except Exception:
        return 0


def cache_base(filename: str) -> str:
    """缓存键里代表这份文档的那一段。

    docx 沿用「去掉扩展名」的老口径（第一波 8 套的缓存必须继续命中）；
    PDF 用**带扩展名**的全名，这样同名的 `Reading.docx` 与 `Reading.pdf` 不会撞键。
    """
    return filename if filename.lower().endswith(".pdf") else os.path.splitext(filename)[0]


def shrink(data: bytes, ext: str, max_side: int = 2200) -> tuple[bytes, str]:
    """超大截图缩到 max_side 以内再发（1.7 MB 的 PNG base64 后要 2.3 MB，白等）。

    缩放只在「确实更大」时发生；失败就原样发（OCR 比省流量重要）。
    """
    try:
        from PIL import Image  # 延迟导入：没有 Pillow 也能跑，只是不缩图
    except Exception:
        return data, ext
    try:
        im = Image.open(io.BytesIO(data))
        if max(im.size) <= max_side and len(data) <= 900_000:
            return data, ext
        ratio = min(1.0, max_side / float(max(im.size)))
        if ratio < 1.0:
            im = im.resize((max(1, int(im.width * ratio)), max(1, int(im.height * ratio))), Image.LANCZOS)
        buf = io.BytesIO()
        im.convert("RGB").save(buf, format="JPEG", quality=88)
        return buf.getvalue(), "jpg"
    except Exception:
        return data, ext


# ── 缓存 ───────────────────────────────────────────────────────────────────
def cache_path(setkey: str, docx_base: str, idx: int) -> str:
    safe = re.sub(r"[^\w.-]+", "_", docx_base)
    return os.path.join(CACHE_DIR, f"{setkey}__{safe}__img{idx}.txt")


def read_cache(setkey: str, docx_base: str, idx: int) -> str | None:
    p = cache_path(setkey, docx_base, idx)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def write_cache(setkey: str, docx_base: str, idx: int, text: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    p = cache_path(setkey, docx_base, idx)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)
    return p


def cached_texts(setkey: str, docx_base: str) -> dict[int, str]:
    """解析器用的只读入口：返回该 docx 已缓存的 {图序: 文本}，不联网。"""
    out: dict[int, str] = {}
    if not os.path.isdir(CACHE_DIR):
        return out
    safe = re.sub(r"[^\w.-]+", "_", docx_base)
    prefix = f"{setkey}__{safe}__img"
    for fn in os.listdir(CACHE_DIR):
        if not fn.startswith(prefix) or not fn.endswith(".txt"):
            continue
        m = re.match(re.escape(prefix) + r"(\d+)\.txt$", fn)
        if not m:
            continue
        try:
            with open(os.path.join(CACHE_DIR, fn), "r", encoding="utf-8") as fh:
                out[int(m.group(1))] = fh.read()
        except OSError:
            pass
    return out


# ── Qwen3-VL 调用 ──────────────────────────────────────────────────────────
class SystemicFailure(Exception):
    pass


def _is_systemic(status: int | None, body: str) -> bool:
    if status in (401, 402, 403, 429):
        return True
    return bool(re.search(r"InvalidApiKey|Arrearage|insufficient|quota|AccessDenied", body, re.I))


def call_qwen(image_bytes: bytes, ext: str, model: str, timeout: int = 120,
              prompt: str | None = None) -> str:
    """`prompt` 缺省 = 逐字转写（本脚本的老行为）。传别的 system prompt 就能让同一个
    客户端做别的视觉任务（extract_bs_pages.py 用它抽造句题的题面结构）——
    调用、鉴权、估价、错误分类只此一份。"""
    import base64

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise SystemicFailure("DASHSCOPE_API_KEY 未配置（.env.local 里没有）")
    base_url = (os.environ.get("DASHSCOPE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    data_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    payload = {
        "model": model,
        "temperature": 0.0,
        "max_tokens": 4096,
        "stream": False,
        "messages": [
            {"role": "system", "content": prompt or TRANSCRIBE_PROMPT},
            {"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_url}}]},
        ],
    }
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if _is_systemic(e.code, body):
            raise SystemicFailure(f"Qwen-VL HTTP {e.code}: {body[:300]}") from e
        raise RuntimeError(f"Qwen-VL HTTP {e.code}: {body[:300]}") from e
    except urllib.error.URLError as e:
        raise SystemicFailure(f"网络错误：{e}") from e
    j = json.loads(body)
    content = ((j.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return strip_fence(content)


def strip_fence(s: str) -> str:
    s = str(s or "").strip()
    s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
    s = re.sub(r"```\s*$", "", s)
    return s.strip()


# ── 主流程 ─────────────────────────────────────────────────────────────────
def setkey_for(folder: str, prefix: str = "rf") -> str:
    """套题文件夹名 → setkey。`6.10` / `6.15-修复版` / `7.8-问题已经修复` → rf0610 / rf0615 / rf0708。

    `rf` 前缀是刻意的：旧源的 setkey 是「3.10新托福真题」这种中文卷名，两套 key 空间
    必须不相交，否则 build_bank 汇总时会互相覆盖。
    """
    leaf = os.path.basename(os.path.normpath(folder))
    m = re.match(r"^\s*(\d{1,2})[.．](\d{1,2})", leaf)
    if not m:
        raise ValueError(f"文件夹名里认不出日期：{leaf}")
    return f"{prefix}{int(m.group(1)):02d}{int(m.group(2)):02d}"


def source_files(folder: str) -> list[str]:
    out = []
    for fn in sorted(os.listdir(folder)):
        if fn.startswith("~$"):
            continue
        if fn.lower().endswith(".docx") or fn.lower().endswith(".pdf"):
            out.append(fn)
    return out


def docx_text_words(path: str) -> int:
    """docx 正文词数（粗口径，只用来判断「内容是不是都在图里」）。"""
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", "replace")
    except Exception:
        return 0
    txt = re.sub(r"<[^>]+>", " ", xml)
    return len([w for w in txt.split() if w])


# 正文词数低于这个数的 docx，判定「内容都在图里」，图要转写。
THIN_DOCX_WORDS = 300
# PDF 文字层每页低于这个词数，判定「整份是截图」，逐页转写。
THIN_PDF_WORDS_PER_PAGE = 20


def needs_ocr(folder: str, fn: str) -> tuple[bool, str]:
    """这份文档要不要转写，以及理由（理由会打印出来，便于人核账）。"""
    path = os.path.join(folder, fn)
    base = os.path.splitext(fn)[0]
    if fn.lower().endswith(".pdf"):
        try:
            import fitz
            with fitz.open(path) as doc:
                pages = len(doc)
        except Exception:
            return False, "PDF 打不开"
        w = pdf_text_words(path)
        if w < max(1, pages) * THIN_PDF_WORDS_PER_PAGE:
            return True, f"图片版 PDF（{pages} 页，文字层仅 {w} 词）"
        return False, f"PDF 有文字层（{w} 词），不需要 OCR"
    # docx：Answers / Reading 的图一律转（答案清单与 RDL 材料常年是截图）；
    # 其余 section 只有在「正文薄到不像话」时才转 —— 否则转到的多半是学生头像这类装饰图。
    if re.search(r"answer|reading", base, re.I):
        return True, "Answers/Reading 的内嵌图"
    w = docx_text_words(path)
    if w < THIN_DOCX_WORDS:
        return True, f"docx 正文只有 {w} 词，内容在图里"
    return False, f"docx 正文 {w} 词，内嵌图判定为装饰"


def plan(folder: str, only: str | None, force: bool, all_sections: bool = False,
         prefix: str = "rf") -> list[dict]:
    """列出待转写清单（已命中缓存的不列，除非 --force）。"""
    setkey = setkey_for(folder, prefix)
    todo = []
    for fn in source_files(folder):
        base = cache_base(fn)
        if only and only.lower() not in fn.lower():
            continue
        if not all_sections:
            ok, _why = needs_ocr(folder, fn)
            if not ok:
                continue
        path = os.path.join(folder, fn)
        for idx, data, ext in source_images(path):
            if not force and read_cache(setkey, base, idx) is not None:
                continue
            todo.append({"setkey": setkey, "docx": fn, "base": base, "idx": idx,
                         "bytes": data, "ext": ext, "path": path})
    return todo


def main() -> int:
    ap = argparse.ArgumentParser(description="重排版真题 —— 图片逐字转写（Qwen3-VL）")
    ap.add_argument("folder", help="套题文件夹路径")
    ap.add_argument("--dry-run", action="store_true", help="只打印将调用张数，不发请求")
    ap.add_argument("--only", help="只处理文件名含该子串的 docx（如 Answers）")
    ap.add_argument("--force", action="store_true", help="忽略缓存重跑")
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or DEFAULT_MODEL)
    ap.add_argument("--max-images", type=int, default=200, help="安全阀：超过这个张数直接停")
    ap.add_argument("--pool", action="store_true",
                    help="题池模式：setkey 用 rp 前缀（与整卷模式的 rf 分开，缓存也各存各的）")
    ap.add_argument("--all-sections", action="store_true",
                    help="忽略「哪些文档需要转写」的判据，所有 docx/pdf 的图都转（慎用，会转到装饰图）")
    args = ap.parse_args()

    load_env()
    folder = os.path.normpath(args.folder)
    if not os.path.isdir(folder):
        print(f"找不到套题文件夹：{folder}", file=sys.stderr)
        return 2

    prefix = "rp" if args.pool else "rf"
    todo = plan(folder, args.only, args.force, args.all_sections, prefix)
    setkey = setkey_for(folder, prefix)
    if args.dry_run:
        for fn in source_files(folder):
            ok, why = needs_ocr(folder, fn)
            print(f"  · [{'转写' if ok else '跳过'}] {fn} —— {why}")
    total_bytes = sum(len(t["bytes"]) for t in todo)
    print(f"■ {os.path.basename(folder)} → {setkey}")
    print(f"待转写 {len(todo)} 张（原始体积 {total_bytes/1024/1024:.1f} MB），"
          f"预计费用 ¥{len(todo)*CNY_PER_IMAGE:.2f}（按 ¥{CNY_PER_IMAGE}/张估）")
    for t in todo:
        print(f"  · {t['docx']} img{t['idx']}  {len(t['bytes'])/1024:.0f} KB")
    if args.dry_run:
        print("（--dry-run，未发任何请求）")
        return 0
    if not todo:
        print("全部命中缓存，零调用。")
        return 0
    if len(todo) > args.max_images:
        print(f"[停] 待转写 {len(todo)} 张超过 --max-images {args.max_images}", file=sys.stderr)
        return 2

    ok = fail = 0
    for i, t in enumerate(todo, start=1):
        data, ext = shrink(t["bytes"], t["ext"])
        try:
            text = call_qwen(data, ext, args.model)
        except SystemicFailure as e:
            print(f"\n[中止] 系统性 API 失败：{e}", file=sys.stderr)
            print(f"  已完成 {ok} 张（已写缓存，重跑不会重复计费）。", file=sys.stderr)
            return EXIT_SYSTEMIC
        except Exception as e:  # 单张失败不拖垮整批
            fail += 1
            print(f"  [{i}/{len(todo)}] {t['docx']} img{t['idx']} 失败：{str(e)[:160]}")
            continue
        if not text.strip():
            fail += 1
            print(f"  [{i}/{len(todo)}] {t['docx']} img{t['idx']} 返回空，不写缓存")
            continue
        write_cache(t["setkey"], t["base"], t["idx"], text)
        ok += 1
        print(f"  [{i}/{len(todo)}] {t['docx']} img{t['idx']} ✓ {len(text)} 字符")
        time.sleep(0.2)

    print(f"\n完成：成功 {ok} / 失败 {fail}，实际调用 {ok+fail} 张，"
          f"约 ¥{(ok+fail)*CNY_PER_IMAGE:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
