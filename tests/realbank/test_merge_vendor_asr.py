#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""merge_vendor_asr.py 的单元测试。

只测「机器能证明对错」的那几件事，全部用合成数据，不碰 D 盘的真实源材料：

  1. 相似度 sim() 必须**按词**比 —— difflib 的 autojunk 在 >200 字符的英文串上
     会把空格和高频字母当噪声丢掉，把一段逐字相同的讲座算成 0.028。这是实际踩过的坑。
  2. framing 剥离只剥开头的短陈述句 —— 正文里的 "Did you listen to the entire
     lecture?" 不许被当成考场提示句剥掉（踩过：整条 LCR 被清空）。
  3. 音频文件名 → 题型的兜底规则（命名不带题材词时按题数判）。
  4. 文档说话人标签 → 两人轮次：Man/Woman、Speaker A/B 直接映射；
     人名/Student-Friend 这类不含性别的标签按出场顺序指派并打标。
  5. 面试题干从 ASR 里截取：从第一个问句开始，前面的引导语全丢。
  6. 基频分离：用 numpy 合成 150Hz / 260Hz 两把「嗓子」拼成的 WAV，
     必须分对；同一把嗓子从头念到尾必须**判失败**（宁可丢题不许瞎标）。

用法: python -m unittest tests.realbank.test_merge_vendor_asr -v
"""
import os
import sys
import wave
import shutil
import struct
import tempfile
import unittest
import importlib.util
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
_spec = importlib.util.spec_from_file_location(
    "merge_vendor_asr", os.path.join(ROOT, "scripts", "realbank", "merge_vendor_asr.py"))
mva = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mva)


def _segs(*texts):
    """把一串文本包成 ASR segments（时间轴按 3 秒一段排）。"""
    return [{"start": i * 3.0, "end": (i + 1) * 3.0, "text": t} for i, t in enumerate(texts)]


class SimilarityTest(unittest.TestCase):
    def test_long_identical_text_scores_1(self):
        """逐字相同的长文本必须是 1.0（autojunk 坑的回归测试）。"""
        t = ("Last week we talked about realism in which artists aimed to depict the world "
             "as it really exists. Today we will explore surrealism. Starting in France in "
             "the nineteen twenties surrealist artists focused on inner reality, concepts "
             "such as fantasy and the nature of dream. Their works reflected a combination "
             "of these inner realities as well as outer reality, that is, things we "
             "physically experience.")
        self.assertGreater(len(t), 200)
        self.assertAlmostEqual(mva.sim(t, t), 1.0, places=6)

    def test_punctuation_and_case_ignored(self):
        self.assertAlmostEqual(mva.sim("How will you plan the weekend trip?",
                                       "how will you plan the weekend trip"), 1.0, places=6)

    def test_unrelated_text_is_low(self):
        self.assertLess(mva.sim("The garden has been beautifully landscaped.",
                                "How many pages do we need to write for this assignment?"),
                        mva.SIM_MIN)

    def test_empty_returns_zero(self):
        self.assertEqual(mva.sim("", "anything"), 0.0)


class FramingTest(unittest.TestCase):
    def test_strips_leading_prompt(self):
        framing, rest = mva.strip_framing(
            _segs("Listen to a talk in an art history class.", "Last week we talked about realism."))
        self.assertIn("art history", framing)
        self.assertEqual(len(rest), 1)

    def test_does_not_strip_body_question(self):
        """正文里的 'Did you listen to the entire lecture?' 不是考场提示句。"""
        framing, rest = mva.strip_framing(_segs("Did you listen to the entire lecture?"))
        self.assertEqual(framing, "")
        self.assertEqual(len(rest), 1)

    def test_does_not_strip_long_sentence(self):
        long_one = ("Listen to the following description of a very long and detailed "
                    "procedure that goes on well past fourteen words in total length.")
        framing, rest = mva.strip_framing(_segs(long_one))
        self.assertEqual(framing, "")
        self.assertEqual(len(rest), 1)


class UnitTypeTest(unittest.TestCase):
    def test_keyword_wins(self):
        self.assertEqual(mva.unit_type("choose_response", 1), "lcr")
        self.assertEqual(mva.unit_type("conversation_bakery", 2), "lc")
        self.assertEqual(mva.unit_type("announcement_bookstore", 2), "la")
        self.assertEqual(mva.unit_type("lecture_surrealism", 4), "lat")

    def test_falls_back_to_question_count(self):
        # 6.20 那套的真实命名：既没有 lecture 也没有 conversation
        self.assertEqual(mva.unit_type("physics_ice_skating", 4), "lat")
        self.assertEqual(mva.unit_type("psychology_overjustification", 4), "lat")
        self.assertEqual(mva.unit_type("mystery_topic", 1), "lcr")


class DocTurnsTest(unittest.TestCase):
    DOC = ("Narrator: Listen to a conversation.\n"
           "{a}: Should we take the train or fly?\n"
           "{b}: The train is slower, but the station is closer.\n"
           "{a}: Train it is then.\n"
           "{b}: Be ready to leave at seven.")

    def test_man_woman_labels(self):
        turns, ok, note = mva.doc_turns(self.DOC.format(a="Man", b="Woman"))
        self.assertTrue(ok)
        self.assertEqual(note, "labels")
        self.assertEqual([t["speaker"] for t in turns], ["Man", "Woman", "Man", "Woman"])

    def test_woman_first(self):
        turns, ok, _ = mva.doc_turns(self.DOC.format(a="Woman", b="Man"))
        self.assertTrue(ok)
        self.assertEqual(turns[0]["speaker"], "Woman")

    def test_speaker_ab_labels(self):
        turns, ok, note = mva.doc_turns(self.DOC.format(a="Speaker A", b="Speaker B"))
        self.assertTrue(ok)
        self.assertEqual(note, "labels")
        self.assertEqual(turns[0]["speaker"], "Man")

    def test_genderless_labels_assigned_by_order_and_flagged(self):
        turns, ok, note = mva.doc_turns(self.DOC.format(a="Student", b="Friend"))
        self.assertTrue(ok)
        self.assertTrue(note.startswith("gender_assigned_by_order"))
        self.assertEqual([t["speaker"] for t in turns], ["Man", "Woman", "Man", "Woman"])

    def test_narrator_dropped(self):
        turns, ok, _ = mva.doc_turns(self.DOC.format(a="Man", b="Woman"))
        self.assertTrue(all("Listen to a conversation" not in t["text"] for t in turns))

    def test_three_labels_rejected(self):
        doc = ("Man: one two three four\nWoman: five six seven\n"
               "Child: eight nine ten\nMan: eleven twelve")
        _, ok, _ = mva.doc_turns(doc)
        self.assertFalse(ok)

    def test_merge_same_speaker(self):
        merged = mva.merge_same_speaker([
            {"speaker": "Man", "text": "A."}, {"speaker": "Man", "text": "B."},
            {"speaker": "Woman", "text": "C."}])
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["text"], "A. B.")


class InterviewStemTest(unittest.TestCase):
    def test_drops_intro_keeps_question_and_directive(self):
        a = {"segments": _segs(
            "Thank you for agreeing to participate. I'd like to ask you some questions about "
            "your work-life balance.",
            "First, do you feel that you currently have a good balance between your work and "
            "personal life? Give details to explain your answer.")}
        stem = mva.interview_stem_from_asr(a)
        self.assertTrue(stem.startswith("Do you feel"), stem)
        self.assertIn("Give details", stem)
        self.assertNotIn("Thank you", stem)

    def test_drops_third_person_intro(self):
        a = {"segments": _segs(
            "The researcher will ask you some questions about artistic activities.",
            "What kind of art do you enjoy the most?")}
        self.assertEqual(mva.interview_stem_from_asr(a), "What kind of art do you enjoy the most?")

    def test_imperative_only_question(self):
        a = {"segments": _segs("Thanks in advance for your time today.",
                               "Describe a time when you felt overwhelmed.")}
        self.assertEqual(mva.interview_stem_from_asr(a), "Describe a time when you felt overwhelmed.")

    def test_empty(self):
        self.assertEqual(mva.interview_stem_from_asr({"segments": []}), "")


def _tone_wav(path, plan, sr=16000):
    """合成一段 WAV：plan = [(基频Hz, 秒数)]。用谐波叠加，接近人声的周期结构。"""
    import numpy as np
    chunks = []
    for f0, secs in plan:
        t = np.arange(int(sr * secs)) / sr
        x = np.zeros_like(t)
        for k, amp in enumerate([1.0, 0.5, 0.3, 0.2], start=1):
            x += amp * np.sin(2 * np.pi * f0 * k * t)
        x /= max(1e-9, np.max(np.abs(x)))
        chunks.append((x * 0.5 * 32767).astype("<i2"))
    data = np.concatenate(chunks)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(data.tobytes())


def _have(cmd):
    return shutil.which(cmd) is not None


@unittest.skipUnless(_have("ffmpeg"), "需要 ffmpeg")
class DiarizeTest(unittest.TestCase):
    """合成「男 150Hz / 女 260Hz 交替」的波形，验证分离与两道守卫。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="mva-diar-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, plan):
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("需要 numpy")
        p = os.path.join(self.tmp, "a.wav")
        _tone_wav(p, plan)
        segs, t = [], 0.0
        for _, secs in plan:
            segs.append({"start": t, "end": t + secs, "text": "x"})
            t += secs
        return mva.diarize(p, segs)

    def test_f0_estimate_is_accurate(self):
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("需要 numpy")
        p = os.path.join(self.tmp, "m.wav")
        _tone_wav(p, [(150.0, 2.0)])
        x = mva.decode_pcm(p)
        self.assertIsNotNone(x)
        self.assertAlmostEqual(mva.f0_median(x), 150.0, delta=8.0)

    def test_alternating_two_voices_separates(self):
        genders, why = self._run([(150.0, 2.0), (260.0, 2.0), (150.0, 2.0),
                                  (260.0, 2.0), (150.0, 2.0), (260.0, 2.0)])
        self.assertIsNotNone(genders, why)
        self.assertEqual(genders, ["male", "female"] * 3)

    def test_single_voice_is_rejected(self):
        genders, why = self._run([(150.0, 2.0)] * 6)
        self.assertIsNone(genders)

    def test_close_pitches_are_rejected(self):
        """两簇差 <50Hz —— 分不开就必须判失败，不许硬分。"""
        genders, why = self._run([(150.0, 2.0), (180.0, 2.0)] * 3)
        self.assertIsNone(genders)
        self.assertIn("基频差", why)

    def test_non_alternating_is_rejected(self):
        """同一角色连说 4 段不像对话轮替 —— 判失败。"""
        genders, why = self._run([(150.0, 2.0)] * 4 + [(260.0, 2.0)] * 2)
        self.assertIsNone(genders)


class ProofreadGuardTest(unittest.TestCase):
    """校对守卫：改动 >5% 一律回退原 ASR，模型不许趁机改写。"""

    def setUp(self):
        self._orig_key = mva.KEY
        mva.KEY = "test-key"

    def tearDown(self):
        mva.KEY = self._orig_key

    def _patch(self, reply):
        import urllib.request

        class _R:
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return self.payload

        import json as _json
        payload = _json.dumps({"choices": [{"message": {"content": reply}}],
                               "usage": {"total_tokens": 10}}).encode("utf-8")
        self._old = urllib.request.urlopen
        urllib.request.urlopen = lambda *a, **k: _R(payload)
        self.addCleanup(lambda: setattr(urllib.request, "urlopen", self._old))

    def test_small_fix_accepted(self):
        src = "The bookstore has been busier than ever and its great to have you with us."
        self._patch("The bookstore has been busier than ever and it's great to have you with us.")
        out, note = mva.proofread(src, "t")
        self.assertTrue(note.startswith("proofread_ok"), note)
        self.assertIn("it's great", out)

    def test_rewrite_rejected(self):
        src = "The bookstore has been busier than ever and it's great to have you with us."
        self._patch("Since we expanded the building, foot traffic has surged, and we are "
                    "delighted that you have chosen to join our team this semester.")
        out, note = mva.proofread(src, "t")
        self.assertTrue(note.startswith("proofread_rejected"), note)
        self.assertEqual(out, src)

    def test_empty_rejected(self):
        src = "Anything at all."
        self._patch("")
        out, note = mva.proofread(src, "t")
        self.assertEqual(note, "proofread_rejected:empty")
        self.assertEqual(out, src)

    def test_no_key_skips(self):
        mva.KEY = ""
        out, note = mva.proofread("abc", "t")
        self.assertEqual(note, "proofread_skipped:no_api_key")
        self.assertEqual(out, "abc")


class LcrStimulusTest(unittest.TestCase):
    BLOCK = ("Q1. How will you plan the weekend trip?\n"
             "Q2. Why did you choose this venue?\n"
             "Q10. What did you think of the student debate?")

    def test_picks_the_right_line(self):
        self.assertEqual(mva.lcr_stimulus_from_doc(self.BLOCK, 2),
                         "Why did you choose this venue?")

    def test_two_digit_number_not_confused_with_one_digit(self):
        self.assertEqual(mva.lcr_stimulus_from_doc(self.BLOCK, 1),
                         "How will you plan the weekend trip?")
        self.assertEqual(mva.lcr_stimulus_from_doc(self.BLOCK, 10),
                         "What did you think of the student debate?")

    def test_missing_number_returns_empty(self):
        self.assertEqual(mva.lcr_stimulus_from_doc(self.BLOCK, 7), "")


class SpeakingDocFirstTest(unittest.TestCase):
    """复述句 / 面试题干：**文档为准，ASR 只做核对**，文档没有就 hold。

    上一版在文档解析漏题时会拿 Whisper 逐字稿顶上去（56 句里顶了 34 句），
    结果 "materials" 被念成 "metals"、三句被粘成一句直接发给用户跟读。
    """

    S1 = "You can select your section and seat."

    def _build(self, doc_sentence, asr_text):
        structured = {"results": [{
            "section": "speaking", "type": "repeat", "context": "campus stadium",
            "items": [{"n": 1, "sentence": doc_sentence}],
        }]}
        asr = {"speaking_listen_repeat_q01.mp3": {"text": asr_text, "segments": _segs(asr_text)}}
        audio = {"speaking_listen_repeat_q01.mp3": "x.mp3"}
        stats = {"repeat_sets": 0, "repeat_sentences": 0,
                 "interview_sets": 0, "interview_questions": 0}
        res = mva.build_speaking("rf9999", structured, asr, audio, stats)
        return [r for r in res if r["type"] == "repeat"][0]["items"][0]

    def test_doc_and_asr_agree(self):
        it = self._build(self.S1, "You can select your section and seat.")
        self.assertTrue(it["usable"])
        self.assertEqual(it["sentence_final"], self.S1)
        self.assertGreaterEqual(it["asr_similarity"], mva.SIM_MIN)

    def test_doc_wins_over_asr_wording(self):
        """ASR 听错个别词也以文档为准（相似度仍过闸）。"""
        it = self._build("Security cameras are used to monitor sensitive materials.",
                         "Security cameras are used to monitor sensitive metals.")
        self.assertTrue(it["usable"])
        self.assertIn("materials", it["sentence_final"])

    def test_mismatch_is_held(self):
        it = self._build(self.S1, "Completely different audio about baking bread today.")
        self.assertFalse(it["usable"])
        self.assertTrue(any(p.startswith("sentence_mismatch") for p in it["problems"]), it["problems"])

    def test_no_doc_sentence_holds_instead_of_falling_back_to_asr(self):
        it = self._build("", "You can select your section and seat.")
        self.assertFalse(it["usable"])
        self.assertEqual(it["sentence_final"], "")
        self.assertIn("no_sentence_in_doc", it["problems"])

    def test_interview_stem_without_doc_holds(self):
        structured = {"results": [{
            "section": "speaking", "type": "interview", "context": "research interview",
            "items": [{"n": 1, "stem": ""}],
        }]}
        text = ("Thank you for agreeing to participate. How often do you use public "
                "transportation like buses or trains? Give details to explain your answer.")
        asr = {"speaking_take_interview_q01.mp3": {"text": text, "segments": _segs(text)}}
        audio = {"speaking_take_interview_q01.mp3": "x.mp3"}
        stats = {"repeat_sets": 0, "repeat_sentences": 0,
                 "interview_sets": 0, "interview_questions": 0}
        r = [x for x in mva.build_speaking("rf9999", structured, asr, audio, stats)
             if x["type"] == "interview"][0]
        self.assertEqual(r["status"], "flagged")
        self.assertFalse(r["items"][0]["usable"])
        self.assertIn("no_stem_in_doc", r["items"][0]["problems"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
