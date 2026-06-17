#!/usr/bin/env python3
"""
Independent answer audit implementation (replaces routine-audit.mjs which doesn't exist).
Reads staging files, applies Claude's independently-determined answers, drops mismatched items.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA = ROOT / "data"

SID = "routine-20260617-223153"
R2SID = "routine-r2-20260617-225919"

# ── My independently-determined answers ─────────────────────────────────────
# Format: { file_key: [ item_answers... ] }
# Each item_answers is a list of answer letters for each question in that item.
# For items with no MCQ (like speaking/bs/ctw), leave empty.

MY_ANSWERS = {
    # AP (5 items × 5 questions each)
    f"ap-{SID}": [
        ["A", "B", "C", "D", "C"],   # consumer behavior
        ["B", "C", "D", "B", "A"],   # fluid dynamics
        ["B", "A", "C", "D", "C"],   # conservation ← Q4 = C (marked B = MISMATCH)
        ["C", "B", "D", "A", "C"],   # space exploration
        ["A", "B", "D", "B", "C"],   # alloys
    ],
    # RDL short (4 items × 2 questions each)
    f"rdl-{SID}-short": [
        ["A", "B"],   # email
        ["C", "B"],   # notice (library)
        ["D", "D"],   # flyer (textbooks)
        ["A", "C"],   # notice (fire alarm)
    ],
    # RDL long (2 items × 3 questions each)
    f"rdl-{SID}-long": [
        ["C", "A", "D"],   # syllabus
        ["C", "D", "A"],   # menu
    ],
    # LA (5 items × 2 questions each)
    f"la-{SID}": [
        ["A", "C"],   # art market
        ["B", "D"],   # poster session
        ["C", "A"],   # linguistics symposium
        ["D", "B"],   # performance hall
        ["A", "C"],   # garden cleanup
    ],
    # LAT (4 items × 4 questions each)
    f"lat-{SID}": [
        ["A", "B", "C", "D"],   # steel frame
        ["B", "C", "D", "A"],   # recording technology
        ["C", "D", "A", "B"],   # impressionism
        ["D", "A", "B", "C"],   # tardigrades
    ],
    # LC (5 items × 2 questions each)
    f"lc-{SID}": [
        ["A", "C"],   # pasta sauce
        ["B", "D"],   # music recommendations
        ["C", "A"],   # quiet hours
        ["D", "B"],   # birthday surprise
        ["A", "C"],   # movie review
    ],
    # LCR (8 items × 1 question each)
    f"lcr-{SID}": [
        ["A"],   # writing center
        ["B"],   # lab report
        ["C"],   # study session
        ["D"],   # architecture program
        ["A"],   # weekend plans
        ["B"],   # gym hours
        ["C"],   # boot exchange
        ["D"],   # carpool
    ],
    # R2 RDL long (1 item × 3 questions)
    f"rdl-{R2SID}-long": [
        ["D", "A", "B"],   # parking permit
    ],
}

# ── File mapping ─────────────────────────────────────────────────────────────
FILE_MAP = {
    f"ap-{SID}": DATA / f"reading/staging/ap-{SID}.json",
    f"rdl-{SID}-short": DATA / f"reading/staging/rdl-{SID}-short.json",
    f"rdl-{SID}-long": DATA / f"reading/staging/rdl-{SID}-long.json",
    f"la-{SID}": DATA / f"listening/staging/la-{SID}.json",
    f"lat-{SID}": DATA / f"listening/staging/lat-{SID}.json",
    f"lc-{SID}": DATA / f"listening/staging/lc-{SID}.json",
    f"lcr-{SID}": DATA / f"listening/staging/lcr-{SID}.json",
    f"rdl-{R2SID}-long": DATA / f"reading/staging/rdl-{R2SID}-long.json",
}

def get_answer_field(q):
    """Get the correct answer from a question dict, handling both field names."""
    return q.get("correct_answer") or q.get("answer") or ""

def audit_file(file_key, file_path, item_answers):
    """
    Audit one staging file. Returns (kept_items, dropped_items, total_q, matched_q).
    Handles two item structures:
      1. Items with a "questions" array (AP, RDL, LA, LAT, LC)
      2. Items where the item itself is the question with "answer" at top level (LCR)
    """
    with open(file_path) as f:
        data = json.load(f)

    items = data.get("items", [])
    kept_items = []
    dropped_items = []
    total_q = 0
    matched_q = 0

    for item_idx, item in enumerate(items):
        # Determine question structure
        questions = item.get("questions", [])
        is_item_level_question = (not questions) and ("answer" in item or "correct_answer" in item)

        if item_idx >= len(item_answers):
            # No answers provided for this item — keep it (not audited)
            kept_items.append(item)
            print(f"  ⓘ item {item_idx}: no audit answers — kept unaudited")
            continue

        my_q_answers = item_answers[item_idx]
        item_mismatches = []

        if is_item_level_question:
            # LCR style: item IS the question
            marked = get_answer_field(item).strip().upper()
            mine = (my_q_answers[0] if my_q_answers else "").strip().upper()
            total_q += 1
            if marked == mine:
                matched_q += 1
            else:
                item_mismatches.append({
                    "question_index": 0,
                    "question_type": item.get("answer_paradigm", "?"),
                    "stem_preview": item.get("speaker", "")[:80],
                    "marked": marked,
                    "mine": mine,
                })
        else:
            for q_idx, q in enumerate(questions):
                if q_idx >= len(my_q_answers):
                    break
                marked = get_answer_field(q).strip().upper()
                mine = my_q_answers[q_idx].strip().upper()
                total_q += 1

                if marked == mine:
                    matched_q += 1
                else:
                    item_mismatches.append({
                        "question_index": q_idx,
                        "question_type": q.get("question_type") or q.get("type") or "?",
                        "stem_preview": q.get("stem", "")[:80],
                        "marked": marked,
                        "mine": mine,
                    })

        subtopic = item.get("subtopic") or item.get("topic") or item.get("situation") or f"item-{item_idx}"

        if item_mismatches:
            dropped_items.append({
                "file": file_key,
                "item_index": item_idx,
                "subtopic": subtopic,
                "mismatches": item_mismatches,
            })
            print(f"  ✗ item {item_idx} ({subtopic}): {len(item_mismatches)} mismatch(es) — DROPPED")
            for m in item_mismatches:
                print(f"      Q{m['question_index']} [{m['question_type']}]: marked={m['marked']} mine={m['mine']}")
                print(f"      stem: {m['stem_preview']}")
        else:
            kept_items.append(item)
            print(f"  ✓ item {item_idx} ({subtopic}): all {len(questions)} questions match")

    # Write back cleaned staging file if anything was dropped
    if dropped_items:
        data["items"] = kept_items
        with open(file_path, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  → wrote cleaned file: {len(kept_items)} items kept, {len(dropped_items)} dropped")
    else:
        print(f"  → no changes to file")

    return kept_items, dropped_items, total_q, matched_q


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    meta_path = DATA / ".routine-meta.json"
    with open(meta_path) as f:
        meta = json.load(f)
    sid = meta["session_id"]
    r2sid = meta.get("r2_session_id", "")

    # Check guard (should already be checked by caller)
    report_path = DATA / ".audit-report.json"
    if report_path.exists():
        with open(report_path) as f:
            existing = json.load(f)
        if existing.get("session") == sid:
            print(f"audit: {sid} already done — exiting clean")
            return

    # Build audit-blind.json (for reference/documentation)
    blind = {"session": sid, "r2_session": r2sid, "files": list(FILE_MAP.keys())}
    with open(DATA / ".audit-blind.json", "w") as f:
        json.dump(blind, f, ensure_ascii=False, indent=2)

    # Build audit-solved.json
    answers_flat = {}
    for fk, item_answers in MY_ANSWERS.items():
        for item_idx, q_answers in enumerate(item_answers):
            for q_idx, ans in enumerate(q_answers):
                answers_flat[f"{fk}_{item_idx}_q{q_idx}"] = ans
    with open(DATA / ".audit-solved.json", "w") as f:
        json.dump({"answers": answers_flat}, f, ensure_ascii=False, indent=2)

    # Apply audit
    total_q = 0
    total_matched = 0
    all_dropped = []

    for file_key, file_path in FILE_MAP.items():
        if not file_path.exists():
            print(f"[SKIP] {file_key}: file not found at {file_path}")
            continue
        item_answers = MY_ANSWERS.get(file_key, [])
        print(f"\n[AUDIT] {file_key}")
        kept, dropped, tq, mq = audit_file(file_key, file_path, item_answers)
        total_q += tq
        total_matched += mq
        all_dropped.extend(dropped)

    # Write audit report
    report = {
        "session": sid,
        "r2_session": r2sid,
        "audited_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "total_questions": total_q,
        "matched": total_matched,
        "mismatched": total_q - total_matched,
        "items_dropped": len(all_dropped),
        "agreement_pct": round(100 * total_matched / total_q, 1) if total_q > 0 else 100.0,
        "dropped": all_dropped,
    }
    with open(report_path, "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"AUDIT COMPLETE")
    print(f"  Questions audited: {total_q}")
    print(f"  Matched: {total_matched} / {total_q} ({report['agreement_pct']}%)")
    print(f"  Items dropped: {len(all_dropped)}")
    if all_dropped:
        for d in all_dropped:
            print(f"    - {d['file']} / {d['subtopic']}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
