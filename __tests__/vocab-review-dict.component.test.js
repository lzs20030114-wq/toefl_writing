/**
 * 复习卡背面的「词典」区。
 *
 * 起因是一张真实的卡：varying 从阅读里收藏进来，背面只有一句 `[计] 改变`。
 * 那一句同时犯了两个错 —— 学生不知道「计」是什么，也看不出这个词其实是 vary
 * 的分词（及物动词「改变」/ 不及物动词「变化」）。ECDICT 给几百个屈折形单收了
 * 这种没音标、只有领域义项的薄条目，收藏时命中的就是它。
 *
 * 所以背面要做两件事：领域标展开成中文并压成灰色（认一眼跳过），
 * 卡上释义太薄时复习当场查一次词典，把原形的完整词性补上。
 */
import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { VocabReview } from "../components/vocab/VocabReview";
import { normalizeCard } from "../lib/vocab/book";

const VARY = {
  word: "vary",
  p: "'vєәri",
  t: "vt. 改变, 使多样化\nvi. 变化, 有不同, 违反",
  g: "TOEFL",
  queried: "varying",
};

jest.mock("../lib/dict/lookup", () => ({
  __esModule: true,
  normalizeWord: (w) => w,
  prefetchShards: () => {},
  lookupWord: jest.fn(),
}));
const { lookupWord } = require("../lib/dict/lookup");

const SENTENCE =
  "Players control the dynamics of soft and loud sounds by varying the pressure on the keys.";

function renderCard(overrides) {
  const card = normalizeCard({
    word: "varying",
    sentence: SENTENCE,
    source: "reading",
    ...overrides,
  });
  render(<VocabReview initialQueue={[card]} onGrade={() => null} onExit={() => {}} />);
  return card;
}

beforeEach(() => {
  lookupWord.mockReset();
  lookupWord.mockResolvedValue(VARY);
});

describe("复习卡背面 · 词典区", () => {
  test("领域标展开成中文，不再是看不懂的「计」", async () => {
    renderCard({ def: "[计] 改变" });
    fireEvent.click(screen.getByText(/显示答案/));
    expect(await screen.findByText("计算机")).toBeInTheDocument();
    expect(screen.queryByText("[计] 改变")).not.toBeInTheDocument();
  });

  test("卡上只有领域义项时，现查词典把原形的完整词性补上", async () => {
    renderCard({ def: "[计] 改变" });
    fireEvent.click(screen.getByText(/显示答案/));
    // 原形说清楚是原形 —— 否则用户会以为音标属于 varying
    expect(await screen.findByText("vary")).toBeInTheDocument();
    expect(screen.getByText("/'vєәri/")).toBeInTheDocument();
    expect(screen.getByText("及物动词")).toBeInTheDocument();
    expect(screen.getByText("不及物动词")).toBeInTheDocument();
    expect(screen.getByText("改变、使多样化")).toBeInTheDocument();
    expect(screen.getByText("变化、有不同、违反")).toBeInTheDocument();
    expect(lookupWord).toHaveBeenCalledWith("varying");
  });

  test("正面不泄题：翻面前既没有释义也没有词典区", async () => {
    renderCard({ def: "[计] 改变" });
    expect(screen.queryByText("计算机")).not.toBeInTheDocument();
    expect(screen.queryByText("及物动词")).not.toBeInTheDocument();
    // 背景里那次查词要落地了再收工，否则它会在下一个用例里才 setState
    await act(async () => {});
  });

  test("卡上词性本来就全的词不额外查词典（一个分片上百 KB，别白拉）", async () => {
    renderCard({
      word: "pattern",
      sentence: "The pattern of migration changed over time.",
      def: "n. 图案",
      defFull: "n. 模范, 典型, 图案\nvt. 模仿, 仿造",
    });
    fireEvent.click(screen.getByText(/显示答案/));
    expect(await screen.findByText("模仿、仿造")).toBeInTheDocument();
    expect(lookupWord).not.toHaveBeenCalled();
  });

  test("查词失败就安静退回卡上存的那条，不影响复习", async () => {
    lookupWord.mockRejectedValue(new Error("offline"));
    renderCard({ def: "[计] 改变" });
    fireEvent.click(screen.getByText(/显示答案/));
    expect(await screen.findByText("改变")).toBeInTheDocument();
    expect(screen.getByText("忘了")).toBeInTheDocument();
  });
});
