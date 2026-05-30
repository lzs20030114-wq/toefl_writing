#!/usr/bin/env python
"""Parse ASR speaking transcripts (.codex-tmp/asr/*) into structured items.

Each 2026-reform speaking audio has two tasks:
  - Listen & Repeat: a setting + 7 sentences to repeat (answer keys already give
    the 7 sentences; AUDIO adds the spoken SETTING/role).
  - Interview: a setting + the interviewer's spoken questions — AUDIO-ONLY
    content not present in answer keys or the (image) speaking PDFs.

Output: data/realExam2026/speaking/interview.json  (+ repeat-settings.json)
"""
import os, re, glob, json

ROOT = r"D:\toefl_writing"
ASR = os.path.join(ROOT, ".codex-tmp", "asr")
OUT = os.path.join(ROOT, "data", "realExam2026", "speaking")
os.makedirs(OUT, exist_ok=True)

def set_date(s):
    m = re.search(r"(\d{1,2})\.(\d{1,2})", s)
    return f"2026-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else "2026"

def lines_of(path):
    out = []
    for ln in open(path, encoding="utf-8").read().splitlines():
        if ln.startswith("#"):
            continue
        out.append(re.sub(r"^\[\d{2}:\d{2}\]\s*", "", ln).strip())
    return [l for l in out if l]

INTERVIEW_MARK = re.compile(r"take an interview|an interviewer will ask|online interview", re.I)
REPEAT_END = re.compile(r"repeat only once", re.I)
SETTING_RE = re.compile(r"(you (?:are|will|work|have|receive|recently|just|signed)|you'?re (?:being|working)|imagine)", re.I)

def parse(path):
    setname = os.path.basename(path).split("__")[0]
    date = set_date(setname)
    lines = lines_of(path)
    full = " ".join(lines)
    # split repeat vs interview
    mi = INTERVIEW_MARK.search(full)
    repeat_part = full[:mi.start()] if mi else full
    interview_part = full[mi.start():] if mi else ""

    # --- repeat setting + sentences ---
    rep_setting = ""
    sm = re.search(r"(You(?:'re| are)[^.?]*\.)\s*(?:Listen to the speaker|Listen carefully|Listen and repeat)", repeat_part, re.I)
    if sm:
        rep_setting = sm.group(1).strip()
    rep_sentences = []
    rend = REPEAT_END.search(repeat_part)
    if rend:
        tail = repeat_part[rend.end():]
        rep_sentences = [s.strip() for s in re.split(r"(?<=[.?!])\s+", tail) if len(s.split()) >= 3]

    # --- interview setting + questions ---
    iv_setting = ""
    im = re.search(r"(You (?:receive|recently received|have (?:signed|scheduled))[^]]*?(?:interview|study|researcher)[^.]*\.(?:[^.]*\.)?)", interview_part, re.I)
    if im:
        iv_setting = re.sub(r"\s+", " ", im.group(1)).strip()
    # questions: sentences ending with '?' after the greeting
    after = interview_part
    gm = re.search(r"(participate|ask you some questions|like to ask you)", interview_part, re.I)
    if gm:
        after = interview_part[gm.end():]
    sents = re.split(r"(?<=[.?!])\s+", after)
    FILLER = re.compile(r"^(thank you|interesting|great|okay|ok|i see|that'?s (?:interesting|great)|wonderful|nice|good|alright|all right|sure|mm-?hmm|now|so|and|well|let'?s (?:start|begin)|i'?d like to ask you[^.?]*\.)[.,!]*\s*", re.I)
    cleaned = []
    for s in sents:
        s = s.strip()
        prev = None
        while prev != s:  # strip stacked filler interjections
            prev = s; s = FILLER.sub("", s).strip()
        if s:
            cleaned.append(s)
    transcript = re.sub(r"\s+", " ", " ".join(cleaned)).strip()
    # questions = each '?'-ending sentence (filler-stripped), boilerplate removed
    questions = [re.sub(r"\s+", " ", s) for s in cleaned
                 if s.endswith("?") and not re.search(r"as much as you can|time allowed|time for preparation", s, re.I)]

    interview = None
    if iv_setting or questions:
        interview = {
            "id": f"{date}_interview", "source": setname, "date": date, "tier": "recalled",
            "type": "interview", "source_kind": "audio-asr",
            "setting": iv_setting, "questions": questions, "transcript": transcript,
        }
    repeat = None
    if rep_setting or rep_sentences:
        repeat = {
            "id": f"{date}_repeat_audio", "source": setname, "date": date, "tier": "recalled",
            "type": "listenAndRepeat", "source_kind": "audio-asr",
            "setting": rep_setting, "sentences": rep_sentences,
        }
    return interview, repeat

def main():
    files = sorted(glob.glob(os.path.join(ASR, "*.txt")))
    files = [f for f in files if re.search(r"speaking|口语", os.path.basename(f), re.I)]
    interviews, repeats = [], []
    for f in files:
        iv, rp = parse(f)
        if iv: interviews.append(iv)
        if rp: repeats.append(rp)
    json.dump({"title": "Speaking Interview tasks (recalled 2026; AUDIO-only, ASR)", "tier": "recalled",
               "source": "2026改后机经 (闲鱼) audio", "count": len(interviews), "items": interviews},
              open(os.path.join(OUT, "interview.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump({"title": "Listen-and-Repeat settings+sentences from audio (recalled 2026)", "tier": "recalled",
               "source": "2026改后机经 (闲鱼) audio", "count": len(repeats), "items": repeats},
              open(os.path.join(OUT, "repeat-from-audio.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"speaking transcripts: {len(files)}")
    print(f"interview tasks: {len(interviews)}  (avg Q: {round(sum(len(x['questions']) for x in interviews)/max(1,len(interviews)),1)})")
    print(f"repeat(audio): {len(repeats)}")

if __name__ == "__main__":
    main()
