"use client";
// 首页「我的题库」section 面板（桌面）。仿 ReadingSectionContent 外壳：标题 + 副标题，
// 主体交给可复用的 MyBankImporter。自持 UpgradeModal（全局 open-upgrade-modal 事件无监听者，不能依赖）。
import { useState } from "react";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { SECTION_ACCENTS } from "./sections";
import UpgradeModal from "../shared/UpgradeModal";
import MyBankImporter from "../userBank/MyBankImporter";

const ACCENT = SECTION_ACCENTS["my-bank"];

export function MyBankSectionContent({
  isChallenge, fadeIn,
  userCode, userTier, isLoggedIn, showLoginModal,
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  return (
    <div style={{ flex: 1, minWidth: 0, fontFamily: HOME_FONT }}>
      {upgradeOpen && (
        <UpgradeModal
          userCode={userCode}
          currentTier={userTier}
          onClose={() => setUpgradeOpen(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}

      <div style={{ marginBottom: 16, ...fadeIn(50) }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
          我的题库 <span style={{ color: ACCENT.color }}>My Bank</span>
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: isChallenge ? CH.t2 : T.t2, lineHeight: 1.5 }}>
          导入你自己的学术讨论 / 邮件题——粘贴文本或上传题目截图，AI 识别后进入你的个人题库，在练习页以「我的」标签出现。
        </p>
      </div>

      <div style={{ ...fadeIn(120) }}>
        <MyBankImporter
          variant="panel"
          code={isLoggedIn ? userCode : ""}
          tier={userTier}
          onRequireUpgrade={() => setUpgradeOpen(true)}
          onRequireLogin={showLoginModal}
        />
      </div>
    </div>
  );
}
