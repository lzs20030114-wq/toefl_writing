"use client";
import { useState, useEffect } from "react";

export const TOKEN_KEY = "toefl-admin-token";

export function getAdminToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function setAdminToken(v) {
  try { localStorage.setItem(TOKEN_KEY, v); } catch { /* no-op */ }
}

export function useAdminToken() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToken(getAdminToken());
    setReady(true);
  }, []);
  function update(v) {
    setToken(v);
    setAdminToken(v);
  }
  return { token, setToken: update, ready };
}

export async function callAdminApi(path, options = {}) {
  const tk = getAdminToken();
  if (!tk) throw new Error("缺少管理员口令");
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-token": tk, ...(options.headers || {}) },
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

export function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

export function relativeTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}个月前`;
}

export function clip(v, n = 140) {
  const s = String(v || "");
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}
