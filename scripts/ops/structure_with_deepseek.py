#!/usr/bin/env python
"""Structure noisy OCR writing text into CLEAN, CONSISTENT JSON via DeepSeek.

Local OCR already did the expensive image->text (zero Claude tokens). Regex
field-parsing is unreliable across 50 varied OCR layouts, so we use the project's
cheap DeepSeek API to turn each set's writing OCR text into a clean schema:
  ad:    {course, professor, professor_question, students:[{name,text}]}
  email: {scenario, recipient, subject, bullets:[]}
Output: .codex-tmp/struct/<set>.json  (one per set).

成本护栏（2026-09-05，起因：9/1 一次录入会话反复 --force 全量重跑，518 次调用 ¥11.97）:
  * 缓存键 = sha1(model + system prompt + 截断后的输入)。改 prompt / 改 OCR 只重跑受影响的
    套卷；输出 JSON 里带 "_cache": {hash, ...}。老输出（没有 _cache）仍视为新鲜、照旧跳过，
    只有 --force 才全量重来。
  * --dry-run 只打印计划：将调用 N 次 / 跳过 M 套 / 预计 tokens 与 ¥（费率见 _usage_ledger）。
  * 真跑前同样先打印计划；计划调用数 > --max-calls（默认 200）且没带 --yes 就中止。
  * 每次调用写一行台账 .ops/deepseek-usage.jsonl（scripts/ops/_usage_ledger.py）。

Usage: python structure_with_deepseek.py [--dry-run] [--force] [--limit=N] [--max-calls=N] [--yes] [set_substr ...]
"""
import os, re, json, glob, sys, time, hashlib, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _usage_ledger as ledger

# 以前写死 r"D:\toefl_writing"；现在按本文件位置推仓库根（在用户机器上仍然解析到同一目录），
# 也可用 TOEFL_ROOT 覆盖，方便在别的机器 / 临时目录上跑 --dry-run 和测试。
ROOT = ledger.repo_root()
CACHE = os.path.join(ROOT, ".codex-tmp", "ocr")
OUTDIR = os.path.join(ROOT, ".codex-tmp", "struct")

MODEL = "deepseek-v4-flash"
URL = "https://api.deepseek.com/chat/completions"
DEFAULT_MAX_CALLS = 200
DEFAULT_EST_COMPLETION_TOKENS = 1500  # 台账没有历史时的估价兜底


def load_env():
    """读 .env.local（其次 .env）；文件不存在返回空 dict，不再让 --dry-run 因缺 key 崩掉。"""
    env = {}
    for name in (".env.local", ".env"):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                m = re.match(r"\s*([A-Z_]+)\s*=\s*(.+?)\s*$", line)
                if m and m.group(1) not in env:
                    env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
        break
    return env


ENV = load_env()
KEY = os.environ.get("DEEPSEEK_API_KEY") or ENV.get("DEEPSEEK_API_KEY", "")
PROXY = os.environ.get("DEEPSEEK_PROXY_URL") or ENV.get("DEEPSEEK_PROXY_URL", "")

SCHEMA_INSTR = (
    "You are given OCR text (with frequent missing spaces and minor errors) of a "
    "TOEFL 2026 writing section that contains an Academic Discussion task and an "
    "Email task. Reconstruct CLEAN text (fix obvious OCR spacing) and return ONLY "
    "JSON with this exact shape:\n"
    '{"ad": {"course": "", "professor": "", "professor_question": "", '
    '"students": [{"name": "", "text": ""}]}, '
    '"email": {"scenario": "", "recipient": "", "subject": "", "bullets": [""]}}\n'
    "Rules: professor_question = ONLY the professor\'s discussion question; reconstruct "
    "any word the OCR truncated (e.g. trailing 'ne' -> 'negative') so it reads as a "
    "complete question ending with '?'. course = the explicit 'teaching a class on X' "
    "subject if present, ELSE the clear academic subject of the professor\'s discussion "
    "(e.g. a discussion of marketing strategy -> 'marketing'); use \"\" only if the "
    "subject is genuinely unclear. students = the 1-3 classmate posts with their names. "
    "email.scenario = the situation paragraph; bullets = the 'do the following' task "
    "points (exclude 'Write as much as you can'). Do NOT invent student posts or facts "
    "not in the text; if a field is truly absent use \"\" "
    "or []. Output JSON only, no prose."
)


# ---------------------------------------------------------------- 网络层 ----
def _post_json(body, timeout):
    """真正发 HTTP 的唯一出口；测试可以 monkeypatch 这个函数。返回 DeepSeek 原始响应 dict。"""
    if not KEY:
        raise RuntimeError("Missing DEEPSEEK_API_KEY (.env.local / env)")
    req = urllib.request.Request(URL, data=json.dumps(body).encode("utf-8"), headers={
        "Authorization": "Bearer %s" % KEY, "Content-Type": "application/json",
    })
    if PROXY:
        host = re.sub(r"^https?://", "", PROXY)
        req.set_proxy(host, "http")
        req.set_proxy(host, "https")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def call_deepseek(text, system=SCHEMA_INSTR, max_chars=9000, timeout=120, label=None, script=None):
    """一次结构化调用：返回 (解析后的 JSON 内容, usage dict)。成功/失败都记台账。"""
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": text[:max_chars]},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "stream": False,
    }
    t0 = time.time()
    try:
        resp = _post_json(body, timeout)
        usage = resp.get("usage") or {}
        content = json.loads(resp["choices"][0]["message"]["content"])
    except Exception as e:
        ledger.record(script=script, label=label, model=MODEL, usage=None,
                      ms=(time.time() - t0) * 1000, ok=False, error=e)
        raise
    ledger.record(script=script, label=label, model=MODEL, usage=usage,
                  ms=(time.time() - t0) * 1000, ok=True)
    return content, usage


# ---------------------------------------------------------------- 缓存键 ----
def cache_key(system, text, max_chars):
    h = hashlib.sha1()
    h.update(MODEL.encode("utf-8")); h.update(b"\n")
    h.update(system.encode("utf-8")); h.update(b"\n")
    h.update(text[:max_chars].encode("utf-8"))
    return h.hexdigest()


def is_fresh(outp, key):
    """输出存在且 (没有 _cache 的老文件 或 hash 一致) → 新鲜，跳过。"""
    if not os.path.exists(outp):
        return False
    try:
        with open(outp, encoding="utf-8") as fh:
            d = json.load(fh)
    except Exception:
        return False
    meta = d.get("_cache")
    if not isinstance(meta, dict):
        return True  # 迁移前的老输出：保持旧语义（存在即跳过），避免升级后无意全量重跑
    return meta.get("hash") == key


# ---------------------------------------------------------------- 输入 ----
def writing_text(setname):
    for f in glob.glob(os.path.join(CACHE, "%s__*.txt" % setname)):
        with open(f, encoding="utf-8") as fh:
            t = fh.read()
        if re.search(r"Make an appropriate sentence|Write an email|professor", t, re.I):
            # keep only the AD/Email tail (drop the BS pages to save tokens)
            mk = re.search(r"(Write an email|Question\s*1\s*of\s*2)", t, re.I)
            return t[mk.start() - 200:] if mk else t
    return None


def list_sets(args, limit):
    sets = sorted({os.path.basename(f).split("__")[0] for f in glob.glob(os.path.join(CACHE, "*.txt"))})
    if args:
        sets = [s for s in sets if any(a in s for a in args)]
    if limit:
        sets = sets[:limit]
    return sets


# ---------------------------------------------------------------- 计划 ----
def parse_argv(argv):
    args = [a for a in argv if not a.startswith("--")]
    opts = {
        "force": "--force" in argv,
        "dry_run": "--dry-run" in argv,
        "yes": "--yes" in argv,
        "limit": next((int(a.split("=")[1]) for a in argv if a.startswith("--limit=")), None),
        "max_calls": next((int(a.split("=")[1]) for a in argv if a.startswith("--max-calls=")), DEFAULT_MAX_CALLS),
    }
    return args, opts


def build_plan(sets, outdir, text_fn, system, max_chars, force):
    """返回 [{set, status, text, key, outp}]，status ∈ call / fresh / missing。"""
    plan = []
    for s in sets:
        outp = os.path.join(outdir, "%s.json" % s)
        txt = text_fn(s)
        if not txt:
            plan.append({"set": s, "status": "missing", "text": None, "key": None, "outp": outp})
            continue
        key = cache_key(system, txt, max_chars)
        if not force and is_fresh(outp, key):
            plan.append({"set": s, "status": "fresh", "text": txt, "key": key, "outp": outp})
        else:
            plan.append({"set": s, "status": "call", "text": txt, "key": key, "outp": outp})
    return plan


def estimate(plan, system, max_chars, script):
    calls = [p for p in plan if p["status"] == "call"]
    est_in = sum((len(system) + len(p["text"][:max_chars])) / 4.0 for p in calls)
    stats = ledger.recent_stats(script)
    if stats:
        est_out = stats["avg_completion"] * len(calls)
        src = "输出按台账最近 %d 次(%s)均值 %.0f tokens" % (stats["count"], stats["scope"], stats["avg_completion"])
    else:
        est_out = DEFAULT_EST_COMPLETION_TOKENS * len(calls)
        src = "输出按兜底 %d tokens/次" % DEFAULT_EST_COMPLETION_TOKENS
    total = est_in + est_out
    rate = ledger.cny_per_mtok()
    return {"calls": len(calls), "est_tokens": total, "est_cny": total * rate / 1e6, "rate": rate, "src": src}


def print_plan(name, plan, est):
    n_fresh = sum(1 for p in plan if p["status"] == "fresh")
    n_miss = sum(1 for p in plan if p["status"] == "missing")
    print("[%s] 计划：将调用 %d 次 · 跳过 %d 套(缓存新鲜) · 无输入 %d 套 · 预计 ≈%.0f tokens ≈ ¥%.2f"
          % (name, est["calls"], n_fresh, n_miss, est["est_tokens"], est["est_cny"]), flush=True)
    print("        估价：%s；费率 ¥%.2f/M（DEEPSEEK_CNY_PER_MTOK，默认为 9/1 账单实测混合单价）" % (est["src"], est["rate"]), flush=True)
    todo = [p["set"] for p in plan if p["status"] == "call"]
    if todo:
        print("        将调用：" + ", ".join(todo[:40]) + (" ..." if len(todo) > 40 else ""), flush=True)


# ---------------------------------------------------------------- 主流程 ----
def run_structuring(name, outdir, text_fn, system, max_chars, timeout, argv, summarize):
    """两个结构化脚本共用的骨架。summarize(data) -> 打印用的一行摘要。返回退出码。"""
    os.makedirs(outdir, exist_ok=True)
    args, opts = parse_argv(argv)
    script = ledger.default_script_name()
    sets = list_sets(args, opts["limit"])
    plan = build_plan(sets, outdir, text_fn, system, max_chars, opts["force"])
    est = estimate(plan, system, max_chars, script)
    print_plan(name, plan, est)
    if opts["dry_run"]:
        print("[%s] --dry-run：未发起任何调用。" % name, flush=True)
        return 0
    if est["calls"] > opts["max_calls"] and not opts["yes"]:
        print("[%s] 中止：计划调用 %d 次超过 --max-calls=%d。确认要花这笔钱请加 --yes，或用 --limit=N / 套卷子串缩小范围。"
              % (name, est["calls"], opts["max_calls"]), flush=True)
        return 2
    ok = err = 0
    skip = sum(1 for p in plan if p["status"] == "fresh")
    for p in plan:
        if p["status"] != "call":
            continue
        s = p["set"]
        try:
            data, usage = call_deepseek(p["text"], system=system, max_chars=max_chars,
                                        timeout=timeout, label=s, script=script)
            out = {"set": s}
            out.update(data)
            out["_cache"] = {
                "hash": p["key"], "model": MODEL,
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            with open(p["outp"], "w", encoding="utf-8") as fh:
                json.dump(out, fh, ensure_ascii=False, indent=2)
            print("OK %s: %s" % (s, summarize(data)), flush=True)
            ok += 1
        except Exception as e:
            print("ERR %s: %s" % (s, e), flush=True)
            err += 1
    print("\n%s: ok=%d err=%d skip=%d" % (name, ok, err, skip), flush=True)
    line = ledger.session_summary()
    if line:
        print(line, flush=True)
    return 0 if err == 0 else 1


def _summarize_writing(data):
    ad = data.get("ad", {}) or {}
    em = data.get("email", {}) or {}
    return "AD course=%r students=%d | Email subj=%r" % (
        ad.get("course", ""), len(ad.get("students", []) or []), em.get("subject", ""))


def main(argv=None):
    return run_structuring(
        name="structured", outdir=OUTDIR, text_fn=writing_text, system=SCHEMA_INSTR,
        max_chars=9000, timeout=120, argv=sys.argv[1:] if argv is None else argv,
        summarize=_summarize_writing,
    )


if __name__ == "__main__":
    sys.exit(main())
