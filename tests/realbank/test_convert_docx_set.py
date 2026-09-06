#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""convert_docx_set.py 的单元测试。

只测「机器能证明对错」的那一半：
  1. 截图套壳 docx（inline_shapes 是图片）→ PDF 页数 == 图片张数，且顺序保留；
  2. 答案 docx（纯文本段落）→ PDF 带文字层，原文一字不差地能读回来；
  3. 输出文件命名符合 "<date> <科目>.pdf" 约定。

用小 fixture（2 张 <5KB 的纯色 PNG）现场生成 docx，跑完即扔，不依赖真实源材料
（真实源在 D 盘桌面，CI/其他机器上不存在）。

用法: python -m unittest tests.realbank.test_convert_docx_set -v
      或直接 python tests/realbank/test_convert_docx_set.py
"""
import io
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                                 "scripts", "realbank"))

import docx  # noqa: E402
import fitz  # noqa: E402
from PIL import Image  # noqa: E402

import convert_docx_set as cds  # noqa: E402

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "realbank")


def _make_png(color, size=(40, 30)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _write_stem_docx(path):
    """两张小图按顺序贴进 docx，模拟截图套壳的正文（写作/口语/听力/阅读）。"""
    d = docx.Document()
    d.add_picture(io.BytesIO(_make_png((255, 0, 0))), width=docx.shared.Inches(1))
    d.add_picture(io.BytesIO(_make_png((0, 0, 255))), width=docx.shared.Inches(1))
    d.save(path)


def _write_answer_docx(path):
    d = docx.Document()
    d.add_paragraph("阅读")
    d.add_paragraph("1a 2b 3c")
    d.add_paragraph("")
    d.add_paragraph("听力")
    d.add_paragraph("1d 2c")
    d.save(path)


class ConvertDocxSetTest(unittest.TestCase):
    def setUp(self):
        os.makedirs(FIXTURE_DIR, exist_ok=True)
        self.tmp = tempfile.mkdtemp(prefix="realbank-fixture-")
        self.set_dir = os.path.join(self.tmp, "5月", "9.9 套一")
        os.makedirs(self.set_dir, exist_ok=True)

        self.stem_docx = os.path.join(FIXTURE_DIR, "9.9 套一 阅读.docx")
        self.answer_docx = os.path.join(FIXTURE_DIR, "9.9 套一 答案.docx")
        _write_stem_docx(self.stem_docx)
        _write_answer_docx(self.answer_docx)
        # 拷进临时源目录树，convert_set 按 SETS 配置的相对路径去找
        shutil.copy2(self.stem_docx, os.path.join(self.set_dir, "9.9 套一 阅读.docx"))
        shutil.copy2(self.answer_docx, os.path.join(self.set_dir, "9.9 套一 答案.docx"))

        self.out_root = os.path.join(self.tmp, "out")
        # 现场往 SETS 表里插一条测试专用的 key，跑完在 tearDown 里清掉，
        # 不污染真实的 7 套配置。
        cds.SETS["_test99"] = {"src": os.path.join("5月", "9.9 套一"), "out": "9.9新托福真题_test"}

    def tearDown(self):
        cds.SETS.pop("_test99", None)
        shutil.rmtree(self.tmp, ignore_errors=True)
        for f in (self.stem_docx, self.answer_docx):
            if os.path.exists(f):
                os.remove(f)

    def test_stem_docx_becomes_pdf_with_one_page_per_image_in_order(self):
        res = cds.convert_set("_test99", src_root=self.tmp, out_root=self.out_root)
        stem_entries = [f for f in res["files"] if f["kind"] == "stem-image-pdf"]
        self.assertEqual(len(stem_entries), 1)
        entry = stem_entries[0]
        self.assertEqual(entry["out"], "_test99 阅读.pdf")
        self.assertEqual(entry["images"], 2)

        out_pdf = os.path.join(res["out_dir"], entry["out"])
        self.assertTrue(os.path.exists(out_pdf))
        doc = fitz.open(out_pdf)
        self.assertEqual(doc.page_count, 2, "PDF 页数必须等于图片张数")
        # 第一页应该是红色图（第一张图），第二页应该是蓝色图（第二张图）——
        # 用页面渲染出的主色验证顺序没有被打乱。
        pix0 = doc.load_page(0).get_pixmap()
        pix1 = doc.load_page(1).get_pixmap()
        px0 = pix0.pixel(pix0.width // 2, pix0.height // 2)
        px1 = pix1.pixel(pix1.width // 2, pix1.height // 2)
        self.assertGreater(px0[0], px0[2], "第一页应为红色图（R>B）")
        self.assertGreater(px1[2], px1[0], "第二页应为蓝色图（B>R）")
        doc.close()

    def test_answer_docx_becomes_text_layer_pdf(self):
        res = cds.convert_set("_test99", src_root=self.tmp, out_root=self.out_root)
        ans_entries = [f for f in res["files"] if f["kind"] == "answer-text-pdf"]
        self.assertEqual(len(ans_entries), 1)
        entry = ans_entries[0]
        self.assertEqual(entry["out"], "_test99 答案.pdf")

        out_pdf = os.path.join(res["out_dir"], entry["out"])
        doc = fitz.open(out_pdf)
        text = doc.load_page(0).get_text()
        doc.close()
        self.assertIn("阅读", text)
        self.assertIn("1a 2b 3c", text)
        self.assertIn("听力", text)
        self.assertIn("1d 2c", text)

    def test_long_answer_line_is_not_truncated(self):
        """回归测试：早期用 Page.insert_text() 画单行时，一行超过约 250 字符会被
        PyMuPDF 在页面右边界悄悄截断（不报错、不换行），下游 NUM_ANS 解析拿到的
        只是半截答案（实测 5 月真题一套 35 题的阅读答案单行就有 220+ 字符）。
        改用 insert_textbox() 自动折行后，长行必须完整出现在提取的文字层里。
        """
        long_line = " ".join(f"{i}ans{i}" for i in range(1, 36))  # 35 题，约 260 字符
        self.assertGreater(len(long_line), 250)
        answer_path = os.path.join(self.set_dir, "9.9 套一 答案.docx")
        d = docx.Document()
        d.add_paragraph("阅读")
        d.add_paragraph(long_line)
        d.save(answer_path)

        res = cds.convert_set("_test99", src_root=self.tmp, out_root=self.out_root)
        entry = next(f for f in res["files"] if f["kind"] == "answer-text-pdf")
        out_pdf = os.path.join(res["out_dir"], entry["out"])
        doc = fitz.open(out_pdf)
        text = " ".join(doc.load_page(0).get_text().split())
        doc.close()
        self.assertIn("35ans35", text, "长答案行的最后一项必须完整出现，不能被截断")

    def test_idempotent_rerun_overwrites_cleanly(self):
        res1 = cds.convert_set("_test99", src_root=self.tmp, out_root=self.out_root)
        res2 = cds.convert_set("_test99", src_root=self.tmp, out_root=self.out_root)
        self.assertEqual(res1["out_dir"], res2["out_dir"])
        names1 = sorted(f["out"] for f in res1["files"])
        names2 = sorted(f["out"] for f in res2["files"])
        self.assertEqual(names1, names2, "重复跑两遍产出的文件集合必须一致，不能累加")


if __name__ == "__main__":
    unittest.main()
