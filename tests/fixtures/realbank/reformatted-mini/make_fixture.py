# -*- coding: utf-8 -*-
"""生成「重排版格式」解析器的最小 docx fixture（跑一次即可，产物已入库）。

刻意**不引用桌面上的真实套题**：测试必须能在任何机器上跑，而真题源料不在仓库里。
这里手写一套 4 份的极小卷，覆盖解析器最容易坏的四处：
  · CTW 挖空还原（`词 _ _` → 完整词，长度/前缀双校验）
  · 造句模板 + 词库 + 干扰项推断（含一个不会出现在答案里的干扰块）
  · Answers 文本解析（行内分号式 + `Sentence Construction Qn:` 式）
  · 听力题号 → 逐题音频路径映射

docx 直接手写成最小 OOXML zip（只有 [Content_Types].xml / _rels/.rels / word/document.xml），
不经 python-docx —— 后者的默认模板会让每份文件涨到 36 KB，四份就 145 KB，
而 fixture 该是几 KB 的东西。解析器只读 word/document.xml，这份最小包足够。

重新生成：  python tests/fixtures/realbank/reformatted-mini/make_fixture.py
"""
import os
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
SET = os.path.join(HERE, "9.9")

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_OPEN = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>')
DOC_CLOSE = "</w:body></w:document>"


def para(text: str) -> str:
    return f'<w:p><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def table(lines) -> str:
    rows = "".join(f"<w:tr><w:tc>{para(l)}</w:tc></w:tr>" for l in lines)
    return f"<w:tbl>{rows}</w:tbl>"


def save(name, blocks):
    body = "".join(table(b[1]) if isinstance(b, tuple) and b[0] == "table" else para(b) for b in blocks)
    os.makedirs(SET, exist_ok=True)
    with zipfile.ZipFile(os.path.join(SET, name), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("word/document.xml", DOC_OPEN + body + DOC_CLOSE)


READING = [
    "TOEFL Reading",
    "Reading Module 1",
    "Fill-in-the-Blank 1: Early Kites",
    "The earliest kites were built from paper and bamboo in ancient workshops. Each kite h _ _ "
    "a light frame and two lo _ _ tails, and children would pu _ _ them into the wind along the "
    "riverbank every single afternoon during the dry season.",
    "Read a notice.",
    ("table", [
        "Library Hours Notice",
        "The main library will close at six o'clock on Friday for annual maintenance work.",
        "Study rooms on the second floor stay open until midnight for registered students.",
    ]),
    "Q21. When does the main library close on Friday?",
    "A. At noon",
    "B. At six o'clock",
    "C. At midnight",
    "D. It does not close",
    "Q22. Who may use the second-floor study rooms until midnight?",
    "A. Registered students",
    "B. Visiting tourists",
    "C. Maintenance staff",
    "D. Library donors",
    "Sleep and Memory",
    "Researchers studying memory have found that sleep does far more than rest the body. During "
    "deep sleep the brain replays the day's experiences, strengthening the connections that store "
    "them. Students who sleep after studying therefore recall more of the material than students "
    "who stay awake for the same number of hours.",
    "Q31. What does the passage say happens during deep sleep?",
    "A. The brain stops all activity",
    "B. The brain replays the day's experiences",
    "C. The body repairs muscle tissue only",
    "D. Memories are permanently erased",
]

WRITING = [
    "TOEFL Writing",
    "Sentence Construction (Questions 1-10)",
    "Sentence Construction 1",
    "Context: Are you planning to attend the seminar next week?",
    "Response: ________ ________ ________ ________ ________ ________ ________.",
    "Word Bank: I have | the | of | to | no intention | seminar | going",
    "Sentence Construction 2",
    "Context: Why were you late this morning?",
    "Response: ________ I ________ ________ ________ ________.",
    "Word Bank: Unfortunately | missed | the | early | bus | were",
    "Write an Email",
    ("table", [
        "Writing | Question 1 of 2",
        "You are a student who missed a laboratory session and you need the missing handouts "
        "from your classmate Nina before the next class meeting.",
        "Write an email to Nina. In your email, do the following:",
        "- Explain why you missed the laboratory session.",
        "- Ask her for a copy of the handouts you missed.",
        "- Suggest a convenient time and place to collect them.",
        "To: Nina",
        "Subject: Request for laboratory handouts",
    ]),
]

LISTENING = [
    "TOEFL Listening",
    "Listening Module 1",
    "Q1. Choose the best response.",
    "Audio: audio/item_level/listening_m1_q01_choose_response.mp3",
    "A. I'll take your word for it.",
    "B. The weather is nice today.",
    "C. We just got back from vacation.",
    "D. We need to make reservations.",
    "Module 1 Q13-Q14",
    "Audio: audio/item_level/listening_m1_q13_q14_conversation_trip.mp3",
    "Q13. What do the speakers decide to do?",
    "A. Take the train",
    "B. Fly to the conference",
    "C. Cancel the trip",
    "D. Drive overnight",
    "Q14. Why does the woman suggest leaving early?",
    "A. To avoid traffic",
    "B. To have time to sightsee",
    "C. To meet a colleague",
    "D. To catch a cheaper fare",
]

ANSWERS = [
    "TOEFL Answers",
    "Reading Answers",
    "Reading Module 1 Fill-in-the-Blank 1: Q1 had; Q2 long; Q3 pull.",
    "Reading Module 1 Multiple Choice: Q21 B; Q22 A; Q31 B.",
    "Listening Answers",
    "Listening Module 1: Q1 C; Q13 A; Q14 B",
    "Listening Transcript",
    "Listening Module 1 Q13-Q14 | Conversation: Conference Trip",
    "Man: Should we take the train or fly to the conference?",
    "Woman: The train is slower, but the station is a short walk from the hotel.",
    "Writing Answers",
    "Sentence Construction Q1: I have no intention of going to the seminar.",
    "Sentence Construction Q2: Unfortunately I missed the early bus.",
]


if __name__ == "__main__":
    save("Reading.docx", READING)
    save("Writing.docx", WRITING)
    save("Listening.docx", LISTENING)
    save("Answers.docx", ANSWERS)
    total = sum(os.path.getsize(os.path.join(SET, f)) for f in os.listdir(SET))
    print(f"fixture 写好: {SET}  共 {total/1024:.1f} KB")
