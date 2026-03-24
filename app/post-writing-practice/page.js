"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C, FONT } from "../../components/shared/ui";

export default function PostWritingPracticeRoute() {
  const router = useRouter();
  const [visible, setVisible] = useState(true);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: visible ? "flex" : "none",
      alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.45)",
      fontFamily: FONT,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "36px 32px",
        maxWidth: 380, width: "90%", textAlign: "center",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔧</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
          功能调试中
        </div>
        <div style={{ fontSize: 14, color: C.t2, lineHeight: 1.6, marginBottom: 24 }}>
          目前本功能正在调试中，请稍后再来。
        </div>
        <button
          onClick={() => { setVisible(false); router.push("/"); }}
          style={{
            background: C.blue, color: "#fff", border: "none",
            borderRadius: 10, padding: "10px 32px",
            fontSize: 15, fontWeight: 600, cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          返回首页
        </button>
      </div>
    </div>
  );
}
