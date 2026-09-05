#!/usr/bin/env python
"""Structure reading-comprehension (AP) OCR into clean JSON via DeepSeek.
Per set: {passages:[{topic, text, questions:[{stem, options:[]}]}]}.
Output: .codex-tmp/struct_ap/<set>.json.

复用 structure_with_deepseek.py 的骨架：哈希缓存 / --dry-run / --max-calls 熔断 / 台账，
用法同它：[--dry-run] [--force] [--limit=N] [--max-calls=N] [--yes] [set_substr ...]
"""
import os, re, glob, sys
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "sd", os.path.join(os.path.dirname(os.path.abspath(__file__)), "structure_with_deepseek.py"))
sd = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(sd)

CACHE = sd.CACHE
OUTDIR = os.path.join(sd.ROOT, ".codex-tmp", "struct_ap")

AP_INSTR = (
    "You are given OCR text (with frequent missing spaces / minor errors) of a "
    "TOEFL 2026 READING section. It contains 'Fill in the missing letters' cloze "
    "paragraphs (IGNORE those) and ACADEMIC COMPREHENSION passages each followed by "
    "multiple-choice questions. Reconstruct CLEAN text and return ONLY JSON:\n"
    '{"passages": [{"topic": "", "text": "", "questions": [{"stem": "", "options": ["",""]}]}]}\n'
    "Rules: include only real comprehension passages (academic prose) and their MC "
    "questions with answer options. Fix obvious OCR spacing. Do NOT invent content or "
    "answers; omit anything not present. Output JSON only."
)


def reading_text(setname):
    best = None
    for f in glob.glob(os.path.join(CACHE, "%s__*.txt" % setname)):
        b = os.path.basename(f)
        with open(f, encoding="utf-8") as fh:
            t = fh.read()
        if "阅读" in b or re.search(r"according to|comprehension|Reading", t, re.I):
            if best is None or len(t) > len(best):
                best = t
    return best


def _summarize_ap(data):
    ps = data.get("passages", []) or []
    return "passages=%d Qs=%d" % (len(ps), sum(len(p.get("questions", []) or []) for p in ps))


def main(argv=None):
    return sd.run_structuring(
        name="AP structured", outdir=OUTDIR, text_fn=reading_text, system=AP_INSTR,
        max_chars=13000, timeout=180, argv=sys.argv[1:] if argv is None else argv,
        summarize=_summarize_ap,
    )


if __name__ == "__main__":
    sys.exit(main())
