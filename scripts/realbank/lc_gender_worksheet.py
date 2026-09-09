#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""被「判不出说话人性别」扣下的对话（LC）→ 人工听音清单 → 回填覆盖表。

背景：第一来源合流（merge_first_source_asr.py）里 A/B 式对话靠音频基频判性别，
判不出就整段扣下；2026-09-08 有 34 段（约占对话一半）因此没入库，直接卡死听力整卷数。
人工听一遍只需标「先开口的是男是女」，本脚本负责两头：

  --list   扫 .codex-tmp/realbank/<卷>.structured.json，把 status=flagged 且
           problems 含 diarization_failed 的 LC 记录列成 CSV：
           key, set, module, q_start, q_end, audio_role, span_start_sec, span_end_sec,
           first_line, second_line, first_speaker, note
           first_speaker 留空给人填（male / female，也认 男 / 女 / m / f）。
  --apply  读填好的 CSV，合并进 data/realBank/listening/lc-speaker-overrides.json
           （只收合法值，已有条目保留，同键覆盖）。
  --self-test  纯 fixture 自检（__tests__/realbank-lc-gender-worksheet.test.js 调）。

用法：
  python scripts/realbank/lc_gender_worksheet.py --list --csv lc-gender.csv
  python scripts/realbank/lc_gender_worksheet.py --apply lc-gender.csv
  可选 --out-dir 指定 structured.json 所在目录（默认 .codex-tmp/realbank），--overrides 指定覆盖表路径。
"""
import os
import re
import io
import sys
import csv
import json
import glob
import argparse
import tempfile
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT_DIR = os.path.join(ROOT, ".codex-tmp", "realbank")
DEFAULT_OVERRIDES = os.path.join(ROOT, "data", "realBank", "listening", "lc-speaker-overrides.json")

COLUMNS = ["key", "set", "module", "q_start", "q_end", "audio_role", "span_start_sec", "span_end_sec",
           "first_line", "second_line", "first_speaker", "note"]

GENDER_ALIASES = {"male": "male", "m": "male", "man": "male", "男": "male",
                  "female": "female", "f": "female", "woman": "female", "女": "female"}


def norm_gender(v):
    return GENDER_ALIASES.get(str(v or "").strip().lower())


def structured_files(out_dir):
    """<卷>.structured.json（排除 .prev / .fs_parsed / .rw 中间产物）。"""
    out = []
    for p in sorted(glob.glob(os.path.join(out_dir, "*.structured.json"))):
        base = os.path.basename(p)
        if base.endswith((".structured.prev.json", ".structured.fs_parsed.json", ".structured.rw.json")):
            continue
        out.append(p)
    return out


def set_name(path):
    return os.path.basename(path)[:-len(".structured.json")]


def pending_rows(structured, setkey):
    """一份 structured 产物 → 待听 CSV 行（只取判性别失败的 LC）。"""
    rows = []
    for r in structured.get("results", []):
        if r.get("section") != "listening" or r.get("type") != "lc":
            continue
        probs = [str(p) for p in (r.get("problems") or [])]
        if r.get("status") != "flagged" or not any(p.startswith("diarization_failed") for p in probs):
            continue
        why = next((p for p in probs if p.startswith("diarization_failed")), "")
        turns = r.get("turns_raw") or []
        first = turns[0]["text"] if turns else ""
        second = next((t["text"] for t in turns[1:] if t.get("label") != (turns[0].get("label") if turns else None)), "")
        span = r.get("audio_span_sec") or [None, None]
        mod = int(r.get("module") or 0)
        rows.append({
            "key": "%s|M%d|Q%s" % (setkey, mod, r.get("q_start")),
            "set": setkey, "module": mod, "q_start": r.get("q_start"), "q_end": r.get("q_end"),
            "audio_role": "listening_m%d" % mod,
            "span_start_sec": _sec(span[0]), "span_end_sec": _sec(span[1]),
            "first_line": _clip(first), "second_line": _clip(second),
            "first_speaker": "", "note": why.replace("diarization_failed:", ""),
        })
    return rows


def _sec(x):
    try:
        return "%.1f" % float(x)
    except (TypeError, ValueError):
        return ""


def _clip(t, n=140):
    t = re.sub(r"\s+", " ", str(t or "")).strip()
    return t if len(t) <= n else t[:n - 1] + "…"


def write_csv(rows, fh):
    w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: r.get(k, "") for k in COLUMNS})


def read_csv(fh):
    return list(csv.DictReader(fh))


def apply_rows(rows, overrides_path, by="人工听音"):
    """CSV 行 → 合并进覆盖表。返回 (写入条数, 跳过的键)。"""
    if os.path.exists(overrides_path):
        with open(overrides_path, encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = {"overrides": {}}
    data.setdefault("overrides", {})
    written, skipped = 0, []
    for r in rows:
        key = str(r.get("key") or "").strip()
        g = norm_gender(r.get("first_speaker"))
        if not re.match(r"^.+\|M\d+\|Q\d+$", key):
            skipped.append(key or "<空键>")
            continue
        if not g:
            if str(r.get("first_speaker") or "").strip():
                skipped.append(key)  # 填了但不是 male/female
            continue  # 没填的行跳过，不算错
        entry = {"first_speaker": g, "by": by}
        note = str(r.get("note_human") or "").strip()
        if note:
            entry["note"] = note
        data["overrides"][key] = entry
        written += 1
    with open(overrides_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return written, skipped


def cmd_list(args):
    files = structured_files(args.out_dir)
    if args.set:
        files = [f for f in files if set_name(f) in set(args.set)]
    rows = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            rows.extend(pending_rows(json.load(fh), set_name(f)))
    if args.csv:
        with open(args.csv, "w", encoding="utf-8-sig", newline="") as fh:
            write_csv(rows, fh)
        print("待人工听音的对话 %d 段（%d 卷）→ %s" % (len(rows), len(files), args.csv))
    else:
        write_csv(rows, sys.stdout)
    by_set = {}
    for r in rows:
        by_set[r["set"]] = by_set.get(r["set"], 0) + 1
    for k, n in sorted(by_set.items()):
        print("  %s: %d 段" % (k, n), file=sys.stderr)
    return 0


def cmd_apply(args):
    with open(args.apply, encoding="utf-8-sig", newline="") as fh:
        rows = read_csv(fh)
    written, skipped = apply_rows(rows, args.overrides, by=args.by)
    print("回填 %d 条 → %s" % (written, os.path.relpath(args.overrides, ROOT)))
    if skipped:
        print("跳过 %d 行（键不合法或 first_speaker 不是 male/female）：%s" % (len(skipped), ", ".join(skipped[:10])))
    print("下一步：python scripts/realbank/merge_first_source_asr.py --all → build_bank.mjs → assemble_sets.mjs")
    return 0


def self_test():
    fails = []

    def check(name, cond, extra=""):
        if not cond:
            fails.append("%s -> %r" % (name, extra))

    structured = {"results": [
        {"section": "listening", "type": "lc", "module": 1, "q_start": 13, "q_end": 14, "status": "flagged",
         "problems": ["diarization_failed:pitch_gap_too_small"], "audio_span_sec": [61.2, 98.7],
         "turns_raw": [{"label": "a", "text": "Hi, do you have a minute?"}, {"label": "b", "text": "Sure, what's up?"}]},
        {"section": "listening", "type": "lc", "module": 2, "q_start": 4, "q_end": 5, "status": "ok",
         "problems": ["labels"], "turns": [{"speaker": "Man", "text": "x"}]},
        {"section": "listening", "type": "lat", "module": 1, "q_start": 25, "q_end": 28, "status": "flagged",
         "problems": ["diarization_failed:x"]},
        {"section": "listening", "type": "lc", "module": 1, "q_start": 15, "q_end": 16, "status": "flagged",
         "problems": ["transcript_truncated:abc"]},
    ]}
    rows = pending_rows(structured, "卷A")
    check("只取判性别失败的 LC", [r["key"] for r in rows] == ["卷A|M1|Q13"], rows)
    check("前两句与音频区间", rows[0]["first_line"] == "Hi, do you have a minute?" and rows[0]["second_line"] == "Sure, what's up?"
          and rows[0]["span_start_sec"] == "61.2" and rows[0]["audio_role"] == "listening_m1", rows[0])

    buf = io.StringIO()
    write_csv(rows, buf)
    back = read_csv(io.StringIO(buf.getvalue()))
    check("CSV 往返", back[0]["key"] == "卷A|M1|Q13" and back[0]["first_speaker"] == "", back)

    d = tempfile.mkdtemp()
    try:
        ov = os.path.join(d, "ov.json")
        with open(ov, "w", encoding="utf-8") as fh:
            json.dump({"_purpose": "x", "overrides": {"卷B|M1|Q17": {"first_speaker": "male", "by": "old"}}}, fh)
        back[0]["first_speaker"] = "女"
        back.append({"key": "卷A|M2|Q4", "first_speaker": "M"})
        back.append({"key": "卷A|M2|Q6", "first_speaker": "dunno"})
        back.append({"key": "坏键", "first_speaker": "male"})
        back.append({"key": "卷A|M1|Q15", "first_speaker": ""})
        n, skipped = apply_rows(back, ov, by="test")
        with open(ov, encoding="utf-8") as fh:
            data = json.load(fh)
        check("回填条数", n == 2, (n, skipped))
        check("别名归一 + 已有条目保留 + 同键覆盖",
              data["overrides"]["卷A|M1|Q13"]["first_speaker"] == "female"
              and data["overrides"]["卷A|M2|Q4"]["first_speaker"] == "male"
              and data["overrides"]["卷B|M1|Q17"]["by"] == "old"
              and "_purpose" in data, data)
        check("非法值/坏键跳过、空值不算错", skipped == ["卷A|M2|Q6", "坏键"], skipped)

        # structured 文件筛选：排除中间产物
        for name in ["卷A.structured.json", "卷A.structured.prev.json", "卷A.structured.fs_parsed.json",
                     "卷B.structured.rw.json", "卷C.json"]:
            with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
                json.dump(structured, fh)
        check("只认正式 structured 产物", [set_name(f) for f in structured_files(d)] == ["卷A"], structured_files(d))
    finally:
        shutil.rmtree(d, ignore_errors=True)

    if fails:
        print("SELF-TEST FAILED:")
        for f in fails:
            print(" -", f)
        return 1
    print("SELF-TEST OK")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--apply", metavar="CSV")
    ap.add_argument("--csv", metavar="PATH", help="--list 的输出文件（缺省打到 stdout）")
    ap.add_argument("--set", action="append", default=None)
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    ap.add_argument("--overrides", default=DEFAULT_OVERRIDES)
    ap.add_argument("--by", default="人工听音")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if args.apply:
        return cmd_apply(args)
    if args.list:
        return cmd_list(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
