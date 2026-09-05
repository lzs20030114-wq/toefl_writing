#!/usr/bin/env python
"""DeepSeek 调用台账（Python 侧）。与 lib/ai/usageLedger.js 写同一个文件、同一种行格式：

  <仓库根>/.ops/deepseek-usage.jsonl   （.ops/ 已被 .gitignore 忽略）
  {"ts","script","label","model","prompt_tokens","completion_tokens","total_tokens",
   "cached_tokens","ms","ok","error","pid"}

环境变量：
  DEEPSEEK_USAGE_LOG     自定义台账路径；设为 0 关闭
  DEEPSEEK_CNY_PER_MTOK  估价用的混合单价（¥/百万 tokens），默认 5.24 = 2026-09-01 账单实测
  TOEFL_ROOT             仓库根覆盖（默认按本文件位置推两级）

record() 永远不抛错——台账写失败不能拖垮正在跑的批量任务。
"""
import os, sys, json, time, datetime

_DEFAULT_RATE = 5.24
_count = 0
_tokens = 0


def repo_root():
    env = os.environ.get("TOEFL_ROOT", "").strip()
    if env:
        return env
    return os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def ledger_path():
    v = os.environ.get("DEEPSEEK_USAGE_LOG", "").strip()
    if v and v != "0":
        return v
    return os.path.join(repo_root(), ".ops", "deepseek-usage.jsonl")


def enabled():
    return os.environ.get("DEEPSEEK_USAGE_LOG", "").strip() != "0"


def cny_per_mtok():
    try:
        v = float(os.environ.get("DEEPSEEK_CNY_PER_MTOK", "") or _DEFAULT_RATE)
        return v if v > 0 else _DEFAULT_RATE
    except ValueError:
        return _DEFAULT_RATE


def _int(v):
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def default_script_name():
    return os.path.basename(sys.argv[0] or "") or "unknown"


def record(script=None, label=None, model=None, usage=None, ms=None, ok=True, error=None):
    """追加一行；返回 True/False，绝不抛错。"""
    global _count, _tokens
    if not enabled():
        return False
    try:
        usage = usage or {}
        details = usage.get("prompt_tokens_details") or {}
        cached = usage.get("prompt_cache_hit_tokens")
        if cached is None:
            cached = details.get("cached_tokens")
        row = {
            "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "script": script or default_script_name(),
            "label": label if label is not None else "",
            "model": model or "",
            "prompt_tokens": _int(usage.get("prompt_tokens")),
            "completion_tokens": _int(usage.get("completion_tokens")),
            "total_tokens": _int(usage.get("total_tokens")),
            "cached_tokens": _int(cached),
            "ms": _int(ms),
            "ok": bool(ok),
            "pid": os.getpid(),
        }
        if error:
            row["error"] = str(error)[:200]
        p = ledger_path()
        d = os.path.dirname(p)
        if d and not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        with open(p, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        _count += 1
        _tokens += row["total_tokens"]
        if _count % 25 == 0:
            print(_summary_line(), file=sys.stderr, flush=True)
        return True
    except Exception:
        return False


def _summary_line():
    return "[deepseek-usage] 本进程已调用 %d 次 · %d tokens · ≈¥%.2f" % (
        _count, _tokens, _tokens * cny_per_mtok() / 1e6)


def session_summary():
    """给脚本结尾打印用；本进程没记录过就返回空串。"""
    return _summary_line() if _count else ""


def recent_stats(script=None, n=50):
    """最近 n 条成功记录的平均 token（同名脚本优先，没有就用全部）。返回 None 或
    {"count","avg_prompt","avg_completion","avg_total","scope"}。给 --dry-run 估价用。"""
    try:
        p = ledger_path()
        if not os.path.exists(p):
            return None
        rows = []
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r.get("ok") and _int(r.get("total_tokens")) > 0:
                    rows.append(r)
        scope = "same-script"
        pick = [r for r in rows if script and r.get("script") == script]
        if not pick:
            pick, scope = rows, "all-scripts"
        pick = pick[-n:]
        if not pick:
            return None
        k = float(len(pick))
        return {
            "count": len(pick),
            "avg_prompt": sum(_int(r.get("prompt_tokens")) for r in pick) / k,
            "avg_completion": sum(_int(r.get("completion_tokens")) for r in pick) / k,
            "avg_total": sum(_int(r.get("total_tokens")) for r in pick) / k,
            "scope": scope,
        }
    except Exception:
        return None
