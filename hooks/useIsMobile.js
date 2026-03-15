"use client";
import { useState, useEffect } from "react";

/**
 * 检测当前视口是否为移动端宽度。
 * SSR 时返回 false（桌面默认），客户端 mount 后立即修正。
 * 配合 app/mobile.css 的 768px 断点使用——CSS 保底，JS 控制组件树。
 */
export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setIsMobile(mql.matches);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}
