import { getSavedCode } from "../AuthContext";
import { loadHist, SESSION_STORE_EVENTS, setCurrentUser } from "../sessionStore";

// All history pages use the same cached sessions. Refresh on entry and when
// returning to the tab so successful submissions in another tab/device appear.
export function subscribeHistory(onChange, { onSynced } = {}) {
  let disposed = false;
  let initializing = true;
  let foregroundTimer = null;
  const notify = () => {
    if (!disposed) onChange(loadHist());
  };
  const onUpdate = () => {
    notify();
    // setCurrentUser clears a previous account synchronously. That empty cache
    // is not the first completed cloud read for writing's loading state.
    if (!disposed && !initializing) onSynced?.();
  };
  const refreshCloud = () => {
    let request;
    try { request = setCurrentUser(getSavedCode(), { refresh: true }); } catch {}
    notify();
    Promise.resolve(request).then(() => { if (!disposed) onSynced?.(); });
  };
  const onForeground = () => {
    if (document.visibilityState === "hidden") return;
    // Browsers commonly fire both focus and visibilitychange for one return.
    clearTimeout(foregroundTimer);
    foregroundTimer = setTimeout(refreshCloud, 100);
  };
  const onStorage = (event) => {
    if (event.key === null || event.key === "toefl-user-code") refreshCloud();
    else notify();
  };

  window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, onUpdate);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onForeground);
  document.addEventListener("visibilitychange", onForeground);
  refreshCloud();
  initializing = false;
  return () => {
    disposed = true;
    clearTimeout(foregroundTimer);
    window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, onUpdate);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onForeground);
    document.removeEventListener("visibilitychange", onForeground);
  };
}
