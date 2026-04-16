import { createPortal } from "react-dom";
import { FONT } from "../shared/ui";

export function ProTrialGiftModal({ t, onClose }) {
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: FONT }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
      >
        <div style={{ background: "linear-gradient(135deg, #087355, #0891B2)", padding: "28px 24px 22px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, margin: "0 auto 12px", borderRadius: 14, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
            {t.trialTitle}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
            {t.trialSubtitle}
          </div>
        </div>

        <div style={{ padding: "22px 24px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            {[t.trialFeature1, t.trialFeature2, t.trialFeature3].map((text) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: "#ecfdf5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span style={{ fontSize: 14, color: "#1a2420", fontWeight: 600 }}>{text}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: "#5a6b62", textAlign: "center", marginBottom: 16 }}>
            {t.trialExpiry}
          </div>

          <button
            onClick={onClose}
            style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #087355, #0891B2)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
          >
            {t.trialStart}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
