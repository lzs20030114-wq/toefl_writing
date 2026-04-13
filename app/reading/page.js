"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CTWTask } from "../../components/reading/CTWTask";
import { RDLTask } from "../../components/reading/RDLTask";
import { useAuth } from "../../lib/AuthContext";
import { saveSess } from "../../lib/sessionStore";
import CTW_DATA from "../../data/reading/bank/ctw.json";
import RDL_DATA from "../../data/reading/bank/rdl.json";

function pickRandom(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function ReadingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get("type") || "ctw";
  const { tier } = useAuth();
  const isPro = tier === "pro" || tier === "legacy";

  // Pick random item on client side only to avoid SSR hydration mismatch
  const [item, setItem] = useState(null);
  useEffect(() => {
    setItem(type === "rdl" ? pickRandom(RDL_DATA.items) : pickRandom(CTW_DATA.items));
  }, [type]);

  const onExit = () => router.push("/");

  // Gate: Pro only
  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#F4F7F5" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pro 专属功能</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>
            阅读理解模块目前处于测试阶段，仅对 Pro 用户开放。升级 Pro 即可解锁。
          </div>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  function handleNewItem() {
    if (type === "rdl") setItem(pickRandom(RDL_DATA.items));
    else setItem(pickRandom(CTW_DATA.items));
  }

  if (!item) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No questions available</div>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>Generate questions first using the admin pipeline.</div>
          <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  function saveReadingSession(subtype, itemData, result) {
    const pct = result.total > 0 ? result.correct / result.total : 0;
    const band = pct >= 1 ? 6 : pct >= 0.9 ? 5.5 : pct >= 0.8 ? 5 : pct >= 0.7 ? 4.5 : pct >= 0.6 ? 4 : pct >= 0.5 ? 3.5 : pct >= 0.4 ? 3 : pct >= 0.3 ? 2.5 : 2;
    saveSess({
      type: "reading",
      mode: "standard",
      correct: result.correct,
      total: result.total,
      band,
      details: {
        subtype,
        itemId: itemData.id,
        topic: itemData.topic || itemData.genre || "",
        results: result.results,
      },
    });
  }

  if (type === "rdl") {
    return (
      <RDLTask
        item={item}
        onExit={onExit}
        onComplete={(result) => saveReadingSession("rdl", item, result)}
      />
    );
  }

  return (
    <CTWTask
      item={item}
      onExit={onExit}
      onComplete={(result) => saveReadingSession("ctw", item, result)}
    />
  );
}

export default function ReadingPage() {
  return (
    <Suspense fallback={null}>
      <ReadingPageClient />
    </Suspense>
  );
}
