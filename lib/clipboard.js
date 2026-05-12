"use client";

/**
 * Cross-browser clipboard copy.
 *
 * `navigator.clipboard.writeText` requires HTTPS and isn't available in older
 * iOS Safari / iframe contexts. This helper tries the modern API first, then
 * falls back to the hidden-textarea + document.execCommand("copy") trick
 * which works on every browser that ships JS today.
 *
 * Returns true on success, false otherwise. Never throws — the caller can
 * decide how to surface the failure (toast / inline hint / no-op).
 */
export async function copyToClipboard(text) {
  const value = String(text ?? "");
  if (typeof window === "undefined") return false;

  // Modern path — fastest when it works.
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Falls through to legacy path. Common reasons: HTTP page, permissions
      // policy in iframe, iOS Safari prompts, focus loss on tab switch.
    }
  }

  // Legacy path — hidden textarea + execCommand.
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    // Keep off-screen and don't let it scroll the page.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "none";
    ta.style.outline = "none";
    ta.style.boxShadow = "none";
    ta.style.background = "transparent";
    ta.style.opacity = "0";
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    document.body.appendChild(ta);
    // iOS Safari needs a real selection range, not just .focus() + .select().
    ta.focus();
    ta.select();
    if (ta.setSelectionRange) {
      try { ta.setSelectionRange(0, value.length); } catch {}
    }
    const ok = document.execCommand && document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}
