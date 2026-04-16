"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSavedTier } from "../../lib/AuthContext";
import { SpeakingExamShell } from "../../components/mockExam/SpeakingExamShell";
import { C, FONT } from "../../components/shared/ui";

function SpeakingExamClient() {
  const router = useRouter();
  const searchParams = useSearchParams(); // force dynamic rendering
  const onExit = () => router.push("/?section=speaking");

  const [isPro, setIsPro] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const t = getSavedTier();
    setIsPro(t === "pro" || t === "legacy");
    setChecked(true);
  }, []);

  // Wait for tier check
  if (!checked) return null;

  // Pro gate
  if (!isPro) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT,
          background: C.bg,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 360, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{"\uD83D\uDD12"}</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
            Pro {"\u4E13\u5C5E\u529F\u80FD"}
          </div>
          <div
            style={{
              fontSize: 14,
              color: C.t2,
              marginBottom: 20,
              lineHeight: 1.6,
            }}
          >
            {"\u53E3\u8BED\u6A21\u8003\u4EC5\u5BF9 Pro \u7528\u6237\u5F00\u653E\u3002\u5347\u7EA7 Pro \u5373\u53EF\u89E3\u9501\u5B8C\u6574\u53E3\u8BED\u6D4B\u8BD5\u3002"}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              onClick={() => {
                try {
                  window.dispatchEvent(new CustomEvent("open-upgrade-modal"));
                } catch {}
              }}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#F59E0B",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              {"\u5347\u7EA7 Pro"}
            </button>
            <button
              onClick={onExit}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "1px solid " + C.bdr,
                background: "#fff",
                cursor: "pointer",
                fontSize: 14,
                fontFamily: FONT,
                color: C.t1,
              }}
            >
              {"\u8FD4\u56DE\u9996\u9875"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <SpeakingExamShell onExit={onExit} />;
}

export default function SpeakingExamPage() {
  return (
    <Suspense fallback={null}>
      <SpeakingExamClient />
    </Suspense>
  );
}
