"use client";
import { HomeLinkCard } from "../home/HomeTaskCard";
import { useVocabSummary } from "./useVocabSummary";

/**
 * 首页各科目正文里的单词本入口卡。文案随状态变，免得永远显示一句没信息量的说明。
 */
export function VocabLinkCard({ hoverKey, setHoverKey, isChallenge }) {
  const { total, todo, ready } = useVocabSummary();

  const description = !ready
    ? "查词时点「☆ 收藏到单词本」，之后按遗忘曲线安排复习。"
    : total === 0
      ? "阅读/听力复盘里点原文的词，词典弹窗点「☆ 收藏到单词本」就能收进来。"
      : todo > 0
        ? `今天有 ${todo} 个词该过一遍，共收藏 ${total} 词。`
        : `今天的词都过完了，共收藏 ${total} 词。`;

  return (
    <HomeLinkCard
      href="/vocab-notebook"
      cardKey="vocab-notebook"
      hoverKey={hoverKey}
      setHoverKey={setHoverKey}
      isChallenge={isChallenge}
      icon="📕"
      eyebrow="记单词"
      title="单词本"
      description={description}
      badge={ready && todo > 0 ? `待复习 ${todo}` : ready && total > 0 ? `${total} 词` : "暂无收藏"}
    />
  );
}
