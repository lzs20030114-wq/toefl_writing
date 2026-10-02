import { render, screen, fireEvent } from "@testing-library/react";
import { VocabReview } from "../components/vocab/VocabReview";
import { normalizeCard } from "../lib/vocab/book";

jest.mock("../lib/dict/lookup", () => ({ lookupWord: jest.fn(async () => null), normalizeWord: word => word }));
jest.mock("../components/listening/AudioPlayer", () => ({ AudioPlayer: () => <button>播放原句</button> }));
const first = "The bank approved the loan.";
const second = "The bank beside the river was quiet.";
const raw = { word: "bank", def: "河岸专用义", baseDef: "通用义", definitionLocked: true, sentence: first, sentences: [second], state: "review", reps: 1, contextSenses: [{ sentence: first, def: "银行专用义", updatedAt: "2026-10-01T10:00:00Z" }, { sentence: second, def: "河岸专用义", updatedAt: "2026-10-01T10:00:00Z" }] };

test("认词正面不泄露句义，翻面显示本轮轮换原句的对应义", () => {
  render(<VocabReview initialQueue={[normalizeCard({ ...raw, spellingOptOut: true })]} onGrade={() => null} onExit={() => {}} />);
  expect(screen.queryByText("河岸专用义")).toBeNull();
  expect(screen.queryByText("银行专用义")).toBeNull();
  fireEvent.click(screen.getByText(/显示答案/));
  expect(screen.getByText("河岸专用义")).toBeTruthy();
  expect(screen.queryByText("银行专用义")).toBeNull();
});

/** 要会写的词：认词翻面选「记得」后才到拼写那一步。 */
const toSpelling = () => {
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  fireEvent.click(screen.getByRole("button", { name: /记得，去拼写/ }));
};

test("拼写提示对应实际挖空句，不拿主句释义提示另一句", () => {
  render(<VocabReview initialQueue={[normalizeCard(raw)]} onGrade={() => null} onExit={() => {}} />);
  toSpelling();
  expect(screen.getByText("河岸专用义")).toBeTruthy();
  expect(screen.queryByText("银行专用义")).toBeNull();
});



test("采用释义含英文目标词时，拼写提示遮住词形，不能泄题", () => {
  const card = normalizeCard({ ...raw, contextSenses: [{ sentence: second, def: "bank 在此指河岸", updatedAt: "2026-10-01T10:00:00Z" }] });
  render(<VocabReview initialQueue={[card]} onGrade={() => null} onExit={() => {}} />);
  toSpelling();
  expect(screen.queryByText("bank 在此指河岸")).toBeNull();
  expect(screen.getByText("____ 在此指河岸")).toBeTruthy();
});
