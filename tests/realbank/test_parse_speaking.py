#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""parse_reformatted.py 的「口语两块」解析测试。

复述句 / 面试题干在 8 套源料里的排版有五种写法，旧解析器只认其中一种，
结果 56 句复述里有 34 句、32 条面试题干里有 11 条退回了 Whisper 逐字稿
（ASR 会把 materials 听成 metals、把两三句粘成一句）。这里锁死的就是
「五种排版都要认」+「题号以音频文件名为准」这两条。

全部用合成数据，不碰 D 盘的真实源材料。

用法: python -m unittest tests.realbank.test_parse_speaking -v
"""
import os
import sys
import unittest
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
_spec = importlib.util.spec_from_file_location(
    "parse_reformatted", os.path.join(ROOT, "scripts", "realbank", "parse_reformatted.py"))
PR = importlib.util.module_from_spec(_spec)
sys.modules["parse_reformatted"] = PR
_spec.loader.exec_module(PR)
A = PR.audio_names          # 分组对位在 audio_names（merge 那边也要用同一份）


def zones(lines):
    ak = PR.AnswerKey()
    PR.parse_speaking_zones(lines, ak)
    return ak


class TestRepeatLayouts(unittest.TestCase):
    def test_numbered_lines(self):
        """A) `Q1. <句子>` 逐行式（6.15 / 6.22 / 7.16）。"""
        ak = zones(["Speaking Answers", "Listen and Repeat",
                    "Q1. You can select your section and seat.",
                    "Q2. We have many different snacks and drinks for sale."])
        self.assertEqual(ak.repeat[1], "You can select your section and seat.")
        self.assertEqual(ak.repeat[2], "We have many different snacks and drinks for sale.")

    def test_two_column_table(self):
        """C) `Q1 | 句 | Q5 | 句` 双栏表格（6.29 / 7.08）—— 旧解析器整块漏掉。"""
        ak = zones(["Speaking Answers", "Listen and Repeat",
                    "Question | Answer | Question | Answer",
                    "Q1 | Lightly wet your brush before starting to paint. | "
                    "Q5 | Use a smaller brush to add fine details to the picture.",
                    "Q4 | Apply thin layers first to keep the paper from tearing. |  |"])
        self.assertEqual(ak.repeat[1], "Lightly wet your brush before starting to paint.")
        self.assertEqual(ak.repeat[5], "Use a smaller brush to add fine details to the picture.")
        self.assertEqual(ak.repeat[4], "Apply thin layers first to keep the paper from tearing.")
        self.assertNotIn(2, ak.repeat)

    def test_two_questions_jammed_on_one_line(self):
        """D) OCR 把两题挤进一行（7.16 截图接缝处）。"""
        ak = zones(["Listen and Repeat",
                    "Q2. Temperature controls help protect papers."
                    "Q3. Use the catalog system to organize records expertly."])
        self.assertEqual(ak.repeat[2], "Temperature controls help protect papers.")
        self.assertEqual(ak.repeat[3], "Use the catalog system to organize records expertly.")

    def test_wrapped_sentence_is_joined(self):
        """长句被 OCR 断成两行 → 续行接回上一题，而不是顶掉下一题。"""
        ak = zones(["Listen and Repeat",
                    "Q7. When the painting is finished, blow warm air on it",
                    "before moving or storing it.",
                    "Q6 | If a section looks too wet, blot gently."])
        self.assertEqual(
            ak.repeat[7],
            "When the painting is finished, blow warm air on it before moving or storing it.")
        self.assertEqual(ak.repeat[6], "If a section looks too wet, blot gently.")

    def test_zone_ends_at_next_section(self):
        """写作块的正文不许漏进复述句。"""
        ak = zones(["Listen and Repeat", "Q1. Store documents to prevent damage.",
                    "Academic Discussion Sample - Regulatory Accountability",
                    "Q2. I agree with Andrew that stronger legal accountability matters most."])
        self.assertEqual(ak.repeat[1], "Store documents to prevent damage.")
        self.assertNotIn(2, ak.repeat)

    def test_blank_placeholder_is_not_a_sentence(self):
        ak = zones(["Listen and Repeat", "Q1: ________________________________________"])
        self.assertEqual(ak.repeat, {})


class TestInterviewZone(unittest.TestCase):
    def test_stem_and_answer_split(self):
        """`Qn. <题干>` + 下一段 `<参考答案>` 要分成两个字段，不能互相顶掉。"""
        ak = zones([
            "Take an Interview - Sample Responses",
            "Q1. Do you regularly recycle items such as paper, plastic, and glass? Why or why not?",
            "Yes, I regularly recycle paper, plastic, glass, and metal when suitable collection "
            "bins are available, because it keeps reusable materials out of landfills.",
            "Q2. Can you describe the recycling practices in your household or community?",
            "In my household, we separate paper, plastic containers, glass bottles, and "
            "ordinary trash before the weekly collection.",
        ])
        self.assertEqual(
            ak.interview_stem[1],
            "Do you regularly recycle items such as paper, plastic, and glass? Why or why not?")
        self.assertTrue(ak.interview_answer[1].startswith("Yes, I regularly recycle"))
        self.assertEqual(
            ak.interview_stem[2],
            "Can you describe the recycling practices in your household or community?")

    def test_stem_not_ending_with_question_mark(self):
        """"…personal life? Give details to explain your answer." 也是题干，不是参考答案。"""
        ak = zones([
            "Take an Interview",
            "Q1. Do you feel that you currently have a good balance between your work and "
            "personal life? Give details to explain your answer.",
        ])
        self.assertIn(1, ak.interview_stem)
        self.assertEqual(ak.interview_answer, {})

    def test_header_carries_question_number(self):
        """E) `Take an Interview Q3 - Sample Response` 后面直接跟答案（6.20 / 7.08）。

        旧 classify_header 把题号写死成 1，四题的参考答案会互相覆盖成一条。
        """
        ak = zones([
            "Take an Interview Q3 - Sample Response",
            "If I received extra money as a gift, I would divide it instead of spending or "
            "saving all of it, putting most of it into savings for future tuition.",
            "Take an Interview Q4 - Sample Response",
            "Yes, I think schools should teach personal finance because students often face "
            "important money decisions before they have much practical experience.",
        ])
        self.assertEqual(ak.interview_stem, {})
        self.assertTrue(ak.interview_answer[3].startswith("If I received extra money"))
        self.assertTrue(ak.interview_answer[4].startswith("Yes, I think schools"))

    def test_answer_wrapped_across_pages_is_joined(self):
        """截图分页导致答案断成两段 → 接回同一题，而不是变成第 5 题。"""
        ak = zones([
            "Take an Interview",
            "Q4. Some people believe that recycling programs should be mandatory. Do you agree?",
            "I agree that basic recycling programs should be mandatory, provided that "
            "communities make participation practical and affordable for every household.",
            "With convenient services and reasonable standards, a mandatory program can "
            "create consistent habits and conserve resources.",
        ])
        self.assertEqual(sorted(ak.interview_answer), [4])
        self.assertIn("With convenient services", ak.interview_answer[4])


class TestSpeakingGroups(unittest.TestCase):
    """题池：一块 `Listen and Repeat` 底下并排 3~6 组，每组题号都从 Q1 重数。"""

    def test_groups_split_on_question_number_restart(self):
        """7.04 形态：`Task 1.x` 分组、组内 1..7。旧版把 5 组的 Q1 粘成一句。"""
        ak = zones(["Listen and Repeat",
                    "Task 1.1: Course Selection",
                    "1. Enter your name and student ID number.",
                    "2. Browse the course catalog to choose your classes.",
                    "Task 1.2: Woodworking Steps",
                    "1. Measure carefully to avoid mistakes.",
                    "2. Draw a line with a pencil before cutting."])
        self.assertEqual([g["set"] for g in ak.repeat_groups], [1, 2])
        self.assertEqual(ak.repeat_groups[0]["map"][1], "Enter your name and student ID number.")
        self.assertEqual(ak.repeat_groups[1]["map"][1], "Measure carefully to avoid mistakes.")
        # 拍平字段不许再把两组的 Q1 粘一起
        self.assertEqual(ak.repeat[101], "Enter your name and student ID number.")
        self.assertEqual(ak.repeat[201], "Measure carefully to avoid mistakes.")

    def test_form_letter_groups_and_letter_numbered_items(self):
        """8.19 / 8.12 形态：`Form B | 标题` 分组，题号写成 `B1.`。"""
        ak = zones(["Listen and Repeat",
                    "Form A | Campus Coffee Shop",
                    "A1. We serve coffee and tea at the main counter.",
                    "A2. Our pastries are all made fresh daily.",
                    "Form B | Library Facilities",
                    "B1. The computer lab has free Wi-Fi access.",
                    "B2. The reading room is a quiet space for patrons."])
        self.assertEqual([g["set"] for g in ak.repeat_groups], [1, 2])
        self.assertEqual(ak.repeat_groups[1]["map"][2], "The reading room is a quiet space for patrons.")

    def test_explicit_set_number_beats_document_order(self):
        """7.25 / 7.29 形态：文档顺序是 39→22，音频却是 set22→set39，只能认显式组号。"""
        ak = zones(["Listen and Repeat",
                    "University Career Fair",
                    "TOEFL Real Practice Set 39 · Module 1 · Questions 1-7",
                    "Q1. Visit employers to learn about jobs.",
                    "University Cultural Festival",
                    "TOEFL Real Practice Set 22 · Module 1 · Questions 1-7",
                    "Q1. Dance acts are featured throughout the day."])
        self.assertEqual([g["set"] for g in ak.repeat_groups], [39, 22])
        units = [{"n": 2201, "set": 22, "q": 1}, {"n": 3901, "set": 39, "q": 1}]
        res, _ = A.align_speaking_groups(units, ak.repeat_groups)
        self.assertEqual(res[2201], "Dance acts are featured throughout the day.")
        self.assertEqual(res[3901], "Visit employers to learn about jobs.")

    def test_group_title_line_does_not_glue_onto_previous_sentence(self):
        """组与组之间的标题行不许被当成上一句的续行接上去。"""
        ak = zones(["Listen and Repeat",
                    "TOEFL Real Practice Set 39 · Module 1 · Questions 1-7",
                    "Q1. Visit employers to learn about jobs.",
                    "Assist Visitors at the Museum",
                    "TOEFL Real Practice Set 31 · Module 1 · Questions 1-7",
                    "Q1. Ancient artifacts are in the first section."])
        self.assertEqual(ak.repeat_groups[0]["map"][1], "Visit employers to learn about jobs.")

    def test_flat_audio_numbering_falls_back_to_positional(self):
        """7.04 / 7.18：文档分组，音频却是拉通编号 q01..q14 —— 条数相等就按顺序对位。"""
        ak = zones(["Listen and Repeat",
                    "Task 1.1: A", "1. First sentence here.", "2. Second sentence here.",
                    "Task 1.2: B", "1. Third sentence here.", "2. Fourth sentence here."])
        units = [{"n": i, "set": None, "q": i} for i in (1, 2, 3, 4)]
        res, cands = A.align_speaking_groups(units, ak.repeat_groups)
        self.assertEqual([res[i] for i in (1, 2, 3, 4)],
                         ["First sentence here.", "Second sentence here.",
                          "Third sentence here.", "Fourth sentence here."])
        self.assertEqual(cands[1], [])

    def test_unresolvable_grouping_yields_candidates(self):
        """8.12：答案页 3 组、音频只摘了 1 组且是裸编号 —— 不许瞎猜，给候选交给 ASR 裁决。"""
        ak = zones(["Listen and Repeat",
                    "Form A | A", "A1. Alpha sentence one.",
                    "Form B | B", "B1. Bravo sentence one.",
                    "Form C | C", "C1. Charlie sentence one."])
        res, cands = A.align_speaking_groups([{"n": 1, "set": None, "q": 1}], ak.repeat_groups)
        self.assertIsNone(res[1])
        self.assertEqual(cands[1],
                         ["Alpha sentence one.", "Bravo sentence one.", "Charlie sentence one."])

    def test_interview_groups_keep_stem_and_answer_together(self):
        ak = zones(["Take an Interview",
                    "Historical Awareness",
                    "Q1. What is one aspect of history that you find particularly interesting?",
                    "I find everyday social history especially interesting because it shows how "
                    "ordinary people lived, worked, and made decisions every single day.",
                    "Renewable Energy Sources",
                    "Q1. How important is renewable energy to you personally, and why?",
                    "Renewable energy matters to me because it affects both the environment and "
                    "the everyday health of the people living in my city."])
        self.assertEqual(len(ak.interview_groups), 2)
        self.assertTrue(ak.interview_groups[1]["map"][1]["stem"].startswith("How important"))
        self.assertTrue(ak.interview_groups[1]["map"][1]["reference_answer"]
                        .startswith("Renewable energy matters"))


class TestParseSpeakingDocx(unittest.TestCase):
    """Speaking.docx 侧：题号以**音频文件名**为准，作答行四种写法都不该影响它。"""

    def _run_with_file(self, paras_text, ak=None):
        # parse_speaking 先判 Speaking.docx 是否存在，所以拿一个真实存在的文件名顶着
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "Speaking.docx"), "wb").close()
            paras = [PR.Para(t, [], False, i) for i, t in enumerate(paras_text)]
            orig = PR.read_docx
            PR.read_docx = lambda path: paras
            try:
                return PR.parse_speaking(d, ak or PR.AnswerKey())
            finally:
                PR.read_docx = orig

    def test_task_prefixed_heading_and_q_response_rows(self):
        """`Task 1: Listen and Repeat - 场景名` + `Q1. Response: ___` —— 旧版两处都不认。"""
        ak = PR.AnswerKey()
        ak.repeat = {1: "You can select your section and seat.",
                     2: "We have many different snacks and drinks for sale."}
        res = self._run_with_file([
            "TOEFL Speaking",
            "Task 1: Listen and Repeat - University Sporting Event",
            "Listen to the manager's instructions about a university sporting event and "
            "repeat each sentence exactly once after you hear it.",
            "Audio: audio/item_level/speaking_listen_repeat_q01.mp3",
            "Q1. Response: ______________________________",
            "Audio: audio/item_level/speaking_listen_repeat_q02.mp3",
            "Q2. Response: ______________________________",
        ], ak)
        rep = [r for r in res if r["type"] == "repeat"]
        self.assertEqual(len(rep), 1)
        self.assertEqual([i["n"] for i in rep[0]["items"]], [1, 2])
        self.assertEqual(rep[0]["items"][0]["sentence"], "You can select your section and seat.")
        self.assertTrue(rep[0]["context"].startswith("Listen to the manager"))

    def test_colon_underscore_rows(self):
        """`Q1: ______`（6.20 的写法，连 Response 这个词都没有）。"""
        ak = PR.AnswerKey()
        ak.repeat = {1: "Measure each piece carefully before you cut."}
        res = self._run_with_file([
            "Listen and Repeat",
            "Audio: audio/item_level/speaking_listen_repeat_q01.mp3",
            "Q1: ________________________________________",
        ], ak)
        rep = [r for r in res if r["type"] == "repeat"][0]
        self.assertEqual(rep["items"][0]["sentence"], "Measure each piece carefully before you cut.")

    def test_interview_stem_from_docx_wins_over_answer_page(self):
        ak = PR.AnswerKey()
        ak.interview_stem = {1: "答案页里那份（较差）"}
        ak.interview_answer = {1: "Sample answer text."}
        res = self._run_with_file([
            "Take an Interview",
            "Audio: audio/item_level/speaking_take_interview_q01.mp3",
            "Q1. How often do you use public transportation like buses or trains? "
            "Give details to explain your answer.",
            "Response: ________",
        ], ak)
        iv = [r for r in res if r["type"] == "interview"][0]
        self.assertTrue(iv["items"][0]["stem"].startswith("How often do you use"))
        self.assertEqual(iv["items"][0]["reference_answer"], "Sample answer text.")

    def test_interview_stem_falls_back_to_answer_page(self):
        """docx 只有 `Q1. Response: ___` 占位符时用答案页解出来的题干。"""
        ak = PR.AnswerKey()
        ak.interview_stem = {1: "Do you engage in any artistic activities regularly?"}
        res = self._run_with_file([
            "Take an Interview",
            "Audio: audio/item_level/speaking_take_interview_q01.mp3",
            "Q1. Response: ____________________",
        ], ak)
        iv = [r for r in res if r["type"] == "interview"][0]
        self.assertEqual(iv["items"][0]["stem"],
                         "Do you engage in any artistic activities regularly?")

    def test_missing_speaking_docx(self):
        res = PR.parse_speaking(os.path.join(HERE, "__no_such_dir__"), PR.AnswerKey())
        self.assertEqual(res[0]["status"], "flagged")


if __name__ == "__main__":
    unittest.main()
