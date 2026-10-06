"use client";

import { createContext, useContext } from "react";

// 首页内原地切到错题本（与 VocabHomeNavigation 同构）：侧栏 / 移动入口是真 <Link>，
// 普通左键点击拦下来走 navigate()，刷新 / 新标签页仍能打开真实 URL。
const MistakeHomeNavigation = createContext(null);

export function MistakeHomeNavigationProvider({ navigate, children }) {
  return <MistakeHomeNavigation.Provider value={navigate}>{children}</MistakeHomeNavigation.Provider>;
}

export function useMistakeHomeNavigation() {
  return useContext(MistakeHomeNavigation);
}

export function isPlainLeftClick(event) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
