import { useState } from "react";
import { C, FONT } from "../shared/ui";

export function ImportPrompt({ t, count, onImport, onSkip, onDismiss, loading }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: "#7c2d12" }}>
        <div style={{ marginBottom: 8 }}>
          {t.importPrefix} {count} {t.importSuffix}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onImport} disabled={loading} style={{ border: "1px solid #fdba74", background: "#ffedd5", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontFamily: FONT }}>
            {loading ? t.importing : t.import}
          </button>
          <button onClick={onSkip} disabled={loading} style={{ border: "1px solid #fdba74", background: "#fff", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontFamily: FONT }}>
            {t.skip}
          </button>
          <button onClick={() => setConfirmOpen(true)} disabled={loading} style={{ border: "none", background: "none", color: "#9a3412", fontSize: 12, padding: "6px 4px", cursor: "pointer", textDecoration: "underline", fontFamily: FONT }}>
            {t.dismiss}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <div
          onClick={() => setConfirmOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, padding: "24px 24px 20px", width: 320, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 14, fontFamily: FONT }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.t1, marginBottom: 6 }}>{t.dismissConfirmTitle}</div>
              <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>{t.dismissConfirmBody}</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmOpen(false)} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid " + C.bdr, background: "#fff", color: C.t2, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                {t.dismissConfirmCancel}
              </button>
              <button
                onClick={() => { setConfirmOpen(false); onDismiss(); }}
                style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: C.red, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
              >
                {t.dismissConfirmOk}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
