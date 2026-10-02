import { act, fireEvent, render, screen } from "@testing-library/react";
import { VocabReview } from "../components/vocab/VocabReview";
import { normalizeCard } from "../lib/vocab/book";
import { STATE } from "../lib/vocab/srs";

const addresses = require("../public/dict/a.json").addresses;

jest.mock("../lib/dict/lookup", () => ({ __esModule: true, lookupWord: jest.fn() }));
const { lookupWord } = require("../lib/dict/lookup");

beforeEach(() => {
  localStorage.clear();
  lookupWord.mockReset();
});

test("无有效备份的旧卡：异步补全当张可见，本张仍是认词题", async () => {
  let resolveLookup;
  lookupWord.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
  const card = normalizeCard({ word: "addresses", def: "n. …", state: STATE.REVIEW,
    sentence: "It addresses fundamental questions about perception, identity, self-awareness, and subjective experience." });
  render(<VocabReview initialQueue={[card]} onGrade={() => null} onExit={() => {}} />);

  expect(screen.queryByRole("textbox", { name: "拼写英文单词" })).not.toBeInTheDocument();
  expect(lookupWord).toHaveBeenCalledWith("addresses");
  await act(async () => resolveLookup({ word: "addresses", ...addresses }));
  expect(screen.queryByRole("textbox", { name: "拼写英文单词" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  expect(screen.getByText(/称呼\( address的名词复数 \)/)).toBeInTheDocument();
  expect(screen.queryByText("…")).not.toBeInTheDocument();
  // 进队列时没有能当提示的释义：这一张选「记得」不弹拼写（补全的释义下次出现才生效）
  expect(screen.queryByRole("button", { name: /去拼写/ })).not.toBeInTheDocument();
});

test("切到下一张卡时，未返回的新查词不能沿用上一张的释义", async () => {
  const resolvers = {};
  lookupWord.mockImplementation((word) => new Promise((resolve) => { resolvers[word] = resolve; }));
  const cards = [
    normalizeCard({ word: "addresses", def: "n. …", state: STATE.REVIEW,
      sentence: "It addresses fundamental questions." }),
    normalizeCard({ word: "pattern", def: "n. …", state: STATE.REVIEW,
      sentence: "The pattern changed." }),
  ];
  const onGrade = (word) => ({ ...cards.find((card) => card.word === word),
    due: new Date(Date.now() + 86400000).toISOString() });
  render(<VocabReview initialQueue={cards} onGrade={onGrade} onExit={() => {}} />);

  await act(async () => resolvers.addresses({ word: "addresses", ...addresses }));
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  expect(screen.getByText(/称呼\( address的名词复数 \)/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /记得/ }));
  expect(lookupWord).toHaveBeenCalledWith("pattern");
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  expect(screen.queryByText(/称呼\( address的名词复数 \)/)).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "拼写英文单词" })).not.toBeInTheDocument();

  await act(async () => resolvers.pattern({ word: "pattern", t: "n. 图案", p: "" }));
  expect(screen.getByText("图案")).toBeInTheDocument();
});
