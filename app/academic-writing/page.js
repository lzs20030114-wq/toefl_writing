"use client";
import { Suspense, useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WritingTask } from "../../components/writing/WritingTask";
import UsageGateWrapper from "../../components/shared/UsageGateWrapper";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { getTaskTimeSeconds, normalizePracticeMode, PRACTICE_MODE } from "../../lib/practiceMode";
import { normalizeReportLanguage } from "../../lib/reportLanguage";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { loadDoneIds } from "../../lib/sessionStore";
import AD_DATA from "../../data/academicWriting/prompts.json";
import { extractShortTitle } from "../../lib/academicWriting/topicTitle";
import { fetchPersonalBank, mapPersonalToPicker } from "../../lib/userBank/personalBank";
import { stashPromptSnapshot } from "../../lib/history/retry";

function buildAcademicTopics() {
  return (Array.isArray(AD_DATA) ? AD_DATA : [])
    .filter((p) => p && p.id && p.professor?.text)
    .map((p) => ({
      id: p.id,
      tag: p.course || "",
      title: extractShortTitle(p.professor.text),
      subtitle: p.professor.text.length > 120 ? p.professor.text.slice(0, 120) + "..." : p.professor.text,
    }));
}

function AcademicWritingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = normalizePracticeMode(searchParams.get("mode"));
  const isPractice = mode === PRACTICE_MODE.PRACTICE;
  const reportLanguage = normalizeReportLanguage(searchParams.get("lang"));
  const retryPromptId = String(searchParams.get("retryPromptId") || "").trim();
  const initialPracticeRootId = String(searchParams.get("practiceRootId") || "").trim();
  const retryFromAttempt = Number(searchParams.get("retryFromAttempt") || 0);
  // A retry from history reloads that exact prompt and bypasses the practice picker,
  // regardless of mode — so the WritingTask snapshot handoff always gets to run.
  const isRetry = retryPromptId.length > 0;
  const [pickedPromptId, setPickedPromptId] = useState(null);

  // 个人题库（用户导入的讨论题）：运行时拉取，并入 picker（带「我的」标签）。
  const [personalRaw, setPersonalRaw] = useState([]);
  useEffect(() => {
    let alive = true;
    fetchPersonalBank("discussion").then((rows) => { if (alive) setPersonalRaw(rows); });
    return () => { alive = false; };
  }, []);
  const personalById = useMemo(() => {
    const m = new Map();
    for (const raw of personalRaw) m.set(String(raw.id), raw);
    return m;
  }, [personalRaw]);
  const items = useMemo(
    () => [...mapPersonalToPicker("discussion", personalRaw), ...buildAcademicTopics()],
    [personalRaw]
  );

  const onExit = () => router.push(isPractice ? "/?mode=practice" : "/");

  if (isPractice && !isRetry && !pickedPromptId) {
    const doneIds = loadDoneIds(DONE_STORAGE_KEYS.DISCUSSION);
    return (
      <UsageGateWrapper onExit={onExit} practiceMode={mode}>
        <TopicPicker
          title="Academic Discussion"
          section="Writing Practice | Task 3"
          items={items}
          doneIds={doneIds}
          accent={{ color: "#6366F1", soft: "#EEF2FF" }}
          onSelect={(id) => {
            // Personal item → hand its full data to WritingTask via the one-shot snapshot,
            // so a `usr_` id (absent from the static bank) resolves instead of "已下线".
            const raw = personalById.get(String(id));
            if (raw) stashPromptSnapshot("discussion", raw);
            setPickedPromptId(id);
          }}
          onExit={onExit}
        />
      </UsageGateWrapper>
    );
  }

  return (
    <UsageGateWrapper onExit={onExit} practiceMode={mode}>
      <WritingTask
        onExit={isPractice && !isRetry ? () => setPickedPromptId(null) : onExit}
        type="discussion"
        timeLimitSeconds={getTaskTimeSeconds("discussion", mode)}
        practiceMode={mode}
        reportLanguage={reportLanguage}
        initialPromptId={isRetry ? retryPromptId : (isPractice ? pickedPromptId : "")}
        initialPracticeRootId={isRetry ? initialPracticeRootId : ""}
        initialPracticeAttempt={isRetry ? (Number.isFinite(retryFromAttempt) && retryFromAttempt > 0 ? retryFromAttempt + 1 : 1) : 1}
      />
    </UsageGateWrapper>
  );
}

export default function AcademicWritingPage() {
  return (
    <Suspense fallback={null}>
      <AcademicWritingPageClient />
    </Suspense>
  );
}
