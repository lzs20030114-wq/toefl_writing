import { redirect } from "next/navigation";

// 旧地址：错题本已并进首页（左侧栏「错题本」→ /?section=mistakes）。
// 旧深链 ?section=bs|reading|listening 换成首页的 sub 参数，挑战/练习模式 mode 原样带过去。
const SUBJECTS = new Set(["bs", "reading", "listening"]);

export default function MistakeNotebookPage({ searchParams }) {
  const params = new URLSearchParams({ section: "mistakes" });
  const sub = typeof searchParams?.section === "string" ? searchParams.section : "";
  if (SUBJECTS.has(sub)) params.set("sub", sub);
  if (typeof searchParams?.mode === "string") params.set("mode", searchParams.mode);
  redirect(`/?${params.toString()}`);
}
