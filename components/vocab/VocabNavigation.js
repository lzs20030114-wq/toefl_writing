"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NavSidebar } from "../home/NavSidebar";
import { MyReferralModal } from "../home/MyReferralModal";

async function responseBody(response) {
  return response.json().catch(() => ({}));
}

/** Connect the shared home sidebar to the standalone vocabulary route. */
export default function VocabNavigation({
  userCode, userTier, userEmail, authMethod, isLoggedIn, showLoginModal, onLogout,
}) {
  const router = useRouter();
  const [fbOpen, setFbOpen] = useState(false);
  const [fbText, setFbText] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbSent, setFbSent] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [fbHistory, setFbHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);

  const loadFbHistory = useCallback(async () => {
    if (!userCode) {
      setFbHistory([]);
      return;
    }
    try {
      const response = await fetch(`/api/feedback?userCode=${encodeURIComponent(userCode)}`);
      const body = await responseBody(response);
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      setFbHistory(Array.isArray(body?.rows) ? body.rows : []);
    } catch (error) {
      if (fbOpen) setFeedbackMsg({ ok: false, text: error.message || "反馈记录加载失败。" });
    }
  }, [userCode, fbOpen]);

  useEffect(() => { loadFbHistory(); }, [loadFbHistory]);

  async function submitFeedback() {
    const content = fbText.trim();
    if (!content || fbBusy || fbSent) return;
    if (!userCode) {
      showLoginModal();
      return;
    }
    setFbBusy(true);
    setFeedbackMsg(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, content, page: "/vocab-notebook" }),
      });
      const body = await responseBody(response);
      if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
      setFbText("");
      setFbSent(true);
      setFeedbackMsg({ ok: true, text: "反馈已提交。" });
      setTimeout(() => setFbSent(false), 2500);
      await loadFbHistory();
    } catch (error) {
      setFeedbackMsg({ ok: false, text: error.message || "提交失败，请稍后重试。" });
    } finally {
      setFbBusy(false);
    }
  }

  async function copyCode() {
    if (!userCode) {
      setFeedbackMsg({ ok: false, text: "当前没有可复制的登录码。" });
      setFbOpen(true);
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("浏览器不支持剪贴板复制。请手动复制登录码。");
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setFeedbackMsg({ ok: false, text: error.message || "无法访问剪贴板。" });
      setFbOpen(true);
    }
  }

  function openReferral() {
    if (!isLoggedIn) showLoginModal();
    else setReferralOpen(true);
  }

  return (
    <>
      <NavSidebar
        activeSection=""
        onSectionChange={(section) => router.push(`/?section=${encodeURIComponent(section)}`)}
        isChallenge={false}
        userCode={userCode} userTier={userTier} userEmail={userEmail} authMethod={authMethod}
        isLoggedIn={isLoggedIn} showLoginModal={showLoginModal} onLogout={onLogout}
        fbOpen={fbOpen} setFbOpen={setFbOpen} fbText={fbText} setFbText={setFbText}
        fbBusy={fbBusy} fbSent={fbSent} feedbackMsg={feedbackMsg} submitFeedback={submitFeedback}
        fbHistory={fbHistory}
        copied={copied} copyCode={copyCode}
        onOpenReferral={openReferral}
        fadeIn={() => ({})}
      />
      {referralOpen && <MyReferralModal userCode={userCode} onClose={() => setReferralOpen(false)} />}
    </>
  );
}
