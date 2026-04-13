"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CTWTask } from "../../components/reading/CTWTask";
import { RDLTask } from "../../components/reading/RDLTask";
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

  // Pick random item on client side only to avoid SSR hydration mismatch
  const [item, setItem] = useState(null);
  useEffect(() => {
    setItem(type === "rdl" ? pickRandom(RDL_DATA.items) : pickRandom(CTW_DATA.items));
  }, [type]);

  const onExit = () => router.push("/");

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

  if (type === "rdl") {
    return (
      <RDLTask
        item={item}
        onExit={onExit}
        onComplete={(result) => {
          // Could save session here in the future
        }}
      />
    );
  }

  return (
    <CTWTask
      item={item}
      onExit={onExit}
      onComplete={(result) => {
        // Could save session here in the future
      }}
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
