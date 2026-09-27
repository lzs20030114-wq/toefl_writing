import { redirect } from "next/navigation";

export default function VocabNotebookPage({ searchParams }) {
  const params = new URLSearchParams({ section: "vocab" });
  if (typeof searchParams?.mode === "string") params.set("mode", searchParams.mode);
  redirect(`/?${params.toString()}`);
}
