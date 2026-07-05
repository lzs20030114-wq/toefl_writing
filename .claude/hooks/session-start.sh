#!/bin/bash
# Bootstrap rtk (https://github.com/rtk-ai/rtk) for Claude Code on the web.
#
# rtk is a CLI proxy that compresses the output of common dev commands
# (git diff/log/status, grep, test/lint runs, ls, find, ...) by ~60-90%
# before it reaches the model, cutting the biggest token sink in a coding
# session: tool output.
#
# Local machines install rtk once themselves, so this only runs in the
# ephemeral remote (Claude Code on the web) container, where nothing persists
# between sessions and rtk must be re-installed on every session start.
#
# Design: remote-only, idempotent, non-interactive, fail-safe — a download or
# network failure must NEVER abort session startup (always exits 0).
# It runs the vendored, hash-reviewed rtk-install.sh next to this file (not a
# live-fetched script) and pins the release below.

set -uo pipefail

# Only run in the remote (Claude Code on the web) environment.
[ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && exit 0

# Pinned rtk release. rtk publishes only dev/rc pre-releases, so an unpinned
# install (which resolves the non-existent "latest" stable release) FAILS.
# To upgrade, bump this to a newer tag from github.com/rtk-ai/rtk/releases.
RTK_VERSION="dev-0.44.0-rc.308"

BIN_DIR="$HOME/.local/bin"
export PATH="$BIN_DIR:$PATH"

# Persist ~/.local/bin on PATH for the whole session so `rtk` stays callable
# from every Bash tool invocation, not just this hook process.
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install rtk only if not already present (idempotent across resume/compact).
if ! command -v rtk >/dev/null 2>&1; then
  RTK_VERSION="$RTK_VERSION" sh "$HOOK_DIR/rtk-install.sh" >/dev/null 2>&1 \
    || echo "[rtk] install skipped (network/policy) — session continues"
fi

# Enable transparent Bash-output compression for Claude Code (best-effort).
# rtk writes its own PreToolUse rewrite hook, so we don't hand-maintain one.
if command -v rtk >/dev/null 2>&1; then
  rtk init -g >/dev/null 2>&1 || true
  echo "[rtk] ready: $(rtk --version 2>/dev/null || echo installed)"
fi

exit 0
