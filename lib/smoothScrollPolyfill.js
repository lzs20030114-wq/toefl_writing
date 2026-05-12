"use client";

/**
 * Minimal smoothScroll polyfill.
 *
 * Safari < 15.3 (March 2022) ignores `{ behavior: "smooth" }` on
 * scrollIntoView / scrollTo / scrollBy — the page jumps instantly. Modern
 * Safari handles it natively, so this polyfill no-ops on those.
 *
 * Call install() once on app boot. It patches the three relevant
 * methods to fall through to a requestAnimationFrame easing loop only when
 * { behavior: "smooth" } is requested AND the browser lacks native support.
 *
 * Inlined (not an npm dep) because:
 *  - The fix is ~50 lines.
 *  - We only need scrollIntoView + scrollTo + scrollBy; the full
 *    smoothscroll-polyfill package supports edge cases (nested scroll
 *    snapping etc.) we don't use.
 */

const DURATION_MS = 420;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothScrollElement(el, targetTop, targetLeft) {
  const startTop = el.scrollTop;
  const startLeft = el.scrollLeft;
  const deltaTop = targetTop - startTop;
  const deltaLeft = targetLeft - startLeft;
  if (deltaTop === 0 && deltaLeft === 0) return;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / DURATION_MS);
    const k = easeInOutCubic(t);
    el.scrollTop = startTop + deltaTop * k;
    el.scrollLeft = startLeft + deltaLeft * k;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function smoothScrollWindow(targetX, targetY) {
  const startX = window.scrollX;
  const startY = window.scrollY;
  const dx = targetX - startX;
  const dy = targetY - startY;
  if (dx === 0 && dy === 0) return;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / DURATION_MS);
    const k = easeInOutCubic(t);
    window.scrollTo(startX + dx * k, startY + dy * k);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

let installed = false;

export function installSmoothScrollPolyfill() {
  if (installed) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // Native smooth scroll support → no patching needed.
  if ("scrollBehavior" in document.documentElement.style) {
    installed = true;
    return;
  }
  installed = true;

  // Patch scrollIntoView
  const origScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function patched(arg) {
    if (arg && typeof arg === "object" && arg.behavior === "smooth") {
      // Find the nearest scrollable ancestor and animate.
      const rect = this.getBoundingClientRect();
      const block = arg.block || "start";
      const inline = arg.inline || "nearest";
      let scroller = this.parentElement;
      while (scroller && scroller !== document.body) {
        const style = getComputedStyle(scroller);
        const oy = style.overflowY;
        if (oy === "auto" || oy === "scroll") break;
        scroller = scroller.parentElement;
      }
      if (!scroller || scroller === document.body) {
        const yOffset = block === "center"
          ? rect.top + window.scrollY - (window.innerHeight - rect.height) / 2
          : rect.top + window.scrollY;
        const xOffset = inline === "center"
          ? rect.left + window.scrollX - (window.innerWidth - rect.width) / 2
          : window.scrollX;
        smoothScrollWindow(xOffset, yOffset);
      } else {
        const sRect = scroller.getBoundingClientRect();
        const yOffset = block === "center"
          ? scroller.scrollTop + (rect.top - sRect.top) - (sRect.height - rect.height) / 2
          : scroller.scrollTop + (rect.top - sRect.top);
        const xOffset = inline === "center"
          ? scroller.scrollLeft + (rect.left - sRect.left) - (sRect.width - rect.width) / 2
          : scroller.scrollLeft;
        smoothScrollElement(scroller, yOffset, xOffset);
      }
      return;
    }
    return origScrollIntoView.apply(this, arguments);
  };

  // Patch window.scrollTo
  const origScrollTo = window.scrollTo.bind(window);
  window.scrollTo = function patched(...args) {
    if (args.length === 1 && args[0] && typeof args[0] === "object" && args[0].behavior === "smooth") {
      const { top = window.scrollY, left = window.scrollX } = args[0];
      smoothScrollWindow(left, top);
      return;
    }
    return origScrollTo(...args);
  };

  // Patch window.scrollBy
  const origScrollBy = window.scrollBy.bind(window);
  window.scrollBy = function patched(...args) {
    if (args.length === 1 && args[0] && typeof args[0] === "object" && args[0].behavior === "smooth") {
      const { top = 0, left = 0 } = args[0];
      smoothScrollWindow(window.scrollX + left, window.scrollY + top);
      return;
    }
    return origScrollBy(...args);
  };
}
