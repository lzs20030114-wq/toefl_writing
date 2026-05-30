#!/usr/bin/env python
"""Parse ASR listening transcripts (split-set .m4a -> .codex-tmp/asr/*听力*) into
passages and APPEND to the listening bank (these split sets had no 原文 text).

The audio announces each passage with "Listen to a/an <conversation|announcement|
talk|lecture|discussion...>", so we split on that framing. Type:
  conversation -> lc | announcement -> la | talk/lecture/discussion -> lat
Leading utterances before the first framing = the short-response block.
Audio carries the PASSAGES only (question stems live in the 听力 PDF/OCR), so
items store the passage text + setting; questions stay [] (paired later if needed).

Idempotent: removes prior source_kind=="audio-asr" items before re-appending.
"""
import os, re, json, glob

ROOT = r"D:\toefl_writing"
ASR = os.path.join(ROOT, ".codex-tmp", "asr")
LIS = os.path.join(ROOT, "data", "realExam2026", "listening")

FRAME = re.compile(r"\bListen to (?:a|an|the)\s+(conversation|announcement|talk|lecture|discussion|lecture[^.]*)", re.I)
TYPE = {"conversation": "lc", "announcement": "la", "talk": "lat", "lecture": "lat", "discussion": "lat"}

def set_date(s):
    m = re.search(r"(\d{1,2})\.(\d{1,2})", s)
    return f"2026-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else "2026"

def strip_ts(path):
    out = []
    for ln in open(path, encoding="utf-8").read().splitlines():
        if ln.startswith("#"):
            continue
        out.append(re.sub(r"^\[\d{2}:\d{2}\]\s*", "", ln).strip())
    return re.sub(r"\s+", " ", " ".join(out)).strip()

def parse(path):
    s = os.path.basename(path).split("__")[0]
    date = set_date(s)
    full = strip_ts(path)
    items = {"lc": [], "la": [], "lat": [], "short": []}
    marks = list(FRAME.finditer(full))
    if not marks:
        return items
    # short-response block (before first framing)
    head = full[: marks[0].start()].strip()
    if len(head.split()) >= 8:
        items["short"].append({
            "id": f"{date}_audio_short", "source": s, "date": date, "tier": "recalled",
            "type": "shortResponse", "source_kind": "audio-asr", "text": head,
        })
    for i, m in enumerate(marks):
        kind = m.group(1).split()[0].lower()
        t = TYPE.get(kind, "lat")
        body = full[m.end(): marks[i + 1].start() if i + 1 < len(marks) else len(full)].strip(" .")
        if len(body.split()) < 12:
            continue
        item = {
            "id": f"{date}_audio_{kind}{i+1}", "source": s, "date": date, "tier": "recalled",
            "type": t, "subtype": kind, "source_kind": "audio-asr",
            "setting": f"Listen to a {m.group(1).strip()}.",
            "questions": [],
        }
        if t == "lc":
            item["conversation"] = [{"speaker": "", "text": body}]
        else:
            item["transcript"] = body
        items[t].append(item)
    return items

def merge_into(filename, key, new_items):
    p = os.path.join(LIS, filename)
    data = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"items": []}
    kept = [x for x in data.get("items", []) if x.get("source_kind") != "audio-asr"]
    kept.extend(new_items)
    data["items"] = kept
    data["count"] = len(kept)
    json.dump(data, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return len(new_items)

def has_text_transcript(setname):
    # combined sets already have 原文 text -> skip their audio (avoid duplicates)
    return bool(glob.glob(os.path.join(ROOT, ".codex-tmp", "exam_txt", f"{setname}__*原文*.txt")))

def main():
    files = [f for f in glob.glob(os.path.join(ASR, "*.txt")) if re.search(r"听力|listening|module", os.path.basename(f), re.I)]
    agg = {"lc": [], "la": [], "lat": [], "short": []}
    skipped = 0
    for f in sorted(files):
        if has_text_transcript(os.path.basename(f).split("__")[0]):
            skipped += 1; continue
        it = parse(f)
        for k in agg:
            agg[k].extend(it[k])
    a = merge_into("conversations.json", "lc", agg["lc"])
    b = merge_into("announcements.json", "la", agg["la"])
    c = merge_into("lectures.json", "lat", agg["lat"])
    d = merge_into("shortResponse.json", "short", agg["short"])
    print(f"audio listening transcripts: {len(files)} (skipped {skipped} combined-set = already have 原文 text)")
    print(f"appended (split-set audio) -> conversations +{a}, announcements +{b}, lectures +{c}, short +{d}")

if __name__ == "__main__":
    main()
