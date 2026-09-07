#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""audio_names.py —— 逐题音频文件名的读法。

第二波把 16 个文件夹摊开后发现同一个商家用过 5 种听力命名、6 种口语命名。
解析器和合流脚本都按这一份认题号，所以这里锁死两件事：

  1. **第一波的写法逐字不变**（`listening_m1_q13_q14_x` / `speaking_listen_repeat_q03`
     必须还是原来的 module/题号），否则已上线的 rf* 题会改 id；
  2. 新增写法各自映到确定的 (module, q) / (kind, 全局题号)，且带 set 记号时
     两组同题号不再互相覆盖。

全部是纯字符串，不碰 D 盘源材料。

用法: python -m unittest tests.realbank.test_audio_names -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                                "scripts", "realbank"))
import audio_names as A  # noqa: E402


class TestListenNames(unittest.TestCase):
    def test_wave1_canonical_unchanged(self):
        self.assertEqual(A.listen_unit("listening_m1_q13_q14_conversation_x.mp3"),
                         {"module": 1, "q_start": 13, "q_end": 14, "slug": "conversation_x"})
        self.assertEqual(A.listen_unit("listening_m2_q01_choose_response.mp3"),
                         {"module": 2, "q_start": 1, "q_end": 1, "slug": "choose_response"})

    def test_no_module_token_defaults_to_1(self):
        u = A.listen_unit("listening_q13_q14_lecture_x.mp3")
        self.assertEqual((u["module"], u["q_start"], u["q_end"]), (1, 13, 14))

    def test_dash_range_and_set_token(self):
        u = A.listen_unit("listening_1_set2_m1_q05-q08_lecture_x.mp3")
        self.assertEqual((u["module"], u["q_start"], u["q_end"]), (1, 5, 8))

    def test_form_counts_as_module(self):
        u = A.listen_unit("listening_form02_q01_q04_lecture_dark_stores.mp3")
        self.assertEqual((u["module"], u["q_start"], u["q_end"]), (2, 1, 4))

    def test_pool_name_without_question_numbers_is_refused(self):
        # 题号只能由文档的 Audio: 行反查，这里不许瞎猜。
        self.assertIsNone(A.listen_unit("L07_Delayed_Rewards.mp3"))
        self.assertIsNone(A.listen_unit("speaking_listen_repeat_q01.mp3"))


class TestSpeakNames(unittest.TestCase):
    def test_wave1_canonical_unchanged(self):
        self.assertEqual(A.speak_unit("speaking_listen_repeat_q03.mp3"),
                         {"kind": "repeat", "n": 3, "set": None, "setup": False})
        self.assertEqual(A.speak_unit("speaking_take_interview_q01.mp3"),
                         {"kind": "interview", "n": 1, "set": None, "setup": False})

    def test_set_tokens_give_global_numbers(self):
        for fn in ("speaking_listen_repeat_s01_q03.mp3",
                   "speaking_listen_repeat_set1_q3.mp3",
                   "S-R01_q3.mp3"):
            self.assertEqual(A.speak_unit(fn)["n"], 103, fn)
        self.assertEqual(A.speak_unit("speaking_1_set2_repeat_q3_bicycle_tire.mp3")["n"], 203)
        self.assertEqual(A.speak_unit("speaking_repeat_form03_q07.mp3")["n"], 307)

    def test_two_sets_do_not_collide(self):
        a = A.speak_unit("S-R01_q3.mp3")["n"]
        b = A.speak_unit("S-R02_q3.mp3")["n"]
        self.assertNotEqual(a, b)

    def test_kind_is_read_from_the_name(self):
        self.assertEqual(A.speak_unit("speaking_interview_form01_q02.mp3")["kind"], "interview")
        self.assertEqual(A.speak_unit("S-I02_q1.mp3")["kind"], "interview")
        self.assertEqual(A.speak_unit("S-R02_q1.mp3")["kind"], "repeat")

    def test_setup_audio_is_flagged_not_a_question(self):
        for fn in ("speaking_repeat_form03_setup.mp3", "S-I02_setup.mp3"):
            self.assertTrue(A.speak_unit(fn)["setup"], fn)

    def test_non_speaking_names_refused(self):
        self.assertIsNone(A.speak_unit("listening_m1_q01_choose_response.mp3"))
        self.assertIsNone(A.speak_unit("L01_Indigo_Trade.mp3"))


if __name__ == "__main__":
    unittest.main()
