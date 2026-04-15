"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSavedTier } from "../../lib/AuthContext";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { TopicPicker } from "../../components/shared/TopicPicker";
import { RepeatTask } from "../../components/speaking/RepeatTask";
import { InterviewTask } from "../../components/speaking/InterviewTask";
import REPEAT_DATA from "../../data/speaking/bank/repeat.json";
import INTERVIEW_DATA from "../../data/speaking/bank/interview.json";

const SPK_ACCENT = { color: "#F59E0B", soft: "#FFFBEB" };

const DONE_KEYS = {
  REPEAT: "toefl-speaking-repeat-done",
  INTERVIEW: "toefl-speaking-interview-done",
};

function pickRandom(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Pick a set of items for a session.
 * Repeat: 7 sentences from one set.
 * Interview: 4 questions from one set.
 */
function pickItems(type) {
  const bank = type === "repeat" ? REPEAT_DATA : INTERVIEW_DATA;
  const sets = bank.items || [];
  if (sets.length === 0) return null;
  // Each "item" in the bank is a set with a .sentences or .questions array
  const set = pickRandom(sets);
  return set;
}

function buildRepeatTopics() {
  return (REPEAT_DATA.items || []).map((set) => ({
    id: set.id,
    tag: set.topic || "General",
    title: set.sentences?.[0]?.sentence?.slice(0, 60) || set.id,
    subtitle: `${set.sentences?.length || 0} sentences`,
  }));
}

function buildInterviewTopics() {
  return (INTERVIEW_DATA.items || []).map((set) => ({
    id: set.id,
    tag: set.topic || "Mixed",
    title: set.questions?.[0]?.question?.slice(0, 60) || set.id,
    subtitle: `${set.questions?.length || 0} questions`,
  }));
}

function SpeakingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get("type") || "repeat";
  const mode = searchParams.get("mode") || "standard";
  const isPractice = mode === "practice";

  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    const t = getSavedTier();
    setIsPro(t === "pro" || t === "legacy");
  }, []);

  const [pickedSetId, setPickedSetId] = useState(null);
  const [randomSet, setRandomSet] = useState(null);

  // Random pick for standard mode
  useEffect(() => {
    if (isPractice) return;
    const set = pickItems(type);
    setRandomSet(set);
  }, [type, isPractice]);

  const onExit = () => router.push("/?section=speaking");

  // Pro gate
  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pro 专属功能</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>
            口语模块目前处于测试阶段，仅对 Pro 用户开放。升级 Pro 即可解锁。
          </div>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  // Practice mode: topic picker when no set selected
  if (isPractice && !pickedSetId) {
    const bank = type === "repeat" ? REPEAT_DATA : INTERVIEW_DATA;
    if ((bank.items || []).length === 0) {
      return <EmptyState type={type} onExit={onExit} />;
    }
    const doneKey = type === "repeat" ? DONE_KEYS.REPEAT : DONE_KEYS.INTERVIEW;
    const doneIds = loadDoneIds(doneKey);
    const items = type === "repeat" ? buildRepeatTopics() : buildInterviewTopics();
    const title = type === "repeat" ? "Listen & Repeat" : "Take an Interview";
    const section = type === "repeat" ? "Speaking Practice | Task 1" : "Speaking Practice | Task 2";

    return (
      <TopicPicker
        title={title}
        section={section}
        items={items}
        doneIds={doneIds}
        accent={SPK_ACCENT}
        onSelect={(id) => setPickedSetId(id)}
        onExit={onExit}
      />
    );
  }

  // Resolve the active set
  let activeSet;
  if (isPractice && pickedSetId) {
    const bank = type === "repeat" ? REPEAT_DATA : INTERVIEW_DATA;
    activeSet = (bank.items || []).find((s) => s.id === pickedSetId);
  } else {
    activeSet = randomSet;
  }

  if (!activeSet) {
    return <EmptyState type={type} onExit={onExit} />;
  }

  function saveSpeakingSession(result) {
    saveSess({
      type: "speaking",
      mode: isPractice ? "practice" : "standard",
      details: {
        subtype: type,
        setId: activeSet.id,
        topic: activeSet.topic || "",
        ...result,
      },
    });

    // Mark set as done
    const doneKey = type === "repeat" ? DONE_KEYS.REPEAT : DONE_KEYS.INTERVIEW;
    addDoneIds(doneKey, [activeSet.id]);
  }

  const taskOnExit = isPractice ? () => setPickedSetId(null) : onExit;

  if (type === "interview") {
    const questions = activeSet.questions || [];
    if (questions.length === 0) return <EmptyState type={type} onExit={onExit} />;
    return (
      <InterviewTask
        items={questions}
        onComplete={saveSpeakingSession}
        onExit={taskOnExit}
        isPractice={isPractice}
      />
    );
  }

  // Default: repeat
  const sentences = activeSet.sentences || [];
  if (sentences.length === 0) return <EmptyState type={type} onExit={onExit} />;
  return (
    <RepeatTask
      items={sentences}
      onComplete={saveSpeakingSession}
      onExit={taskOnExit}
      isPractice={isPractice}
    />
  );
}

function EmptyState({ type, onExit }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎤</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No questions available</div>
        <div style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
          Generate {type === "repeat" ? "repeat" : "interview"} questions first using the pipeline.
        </div>
        <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
          Back to Home
        </button>
      </div>
    </div>
  );
}

export default function SpeakingPage() {
  return (
    <Suspense fallback={null}>
      <SpeakingPageClient />
    </Suspense>
  );
}
