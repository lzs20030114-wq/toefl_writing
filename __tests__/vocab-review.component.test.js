import { fireEvent, render, screen } from "@testing-library/react";
import { VocabReview } from "../components/vocab/VocabReview";
import { RATING, STATE } from "../lib/vocab/srs";

const card = {
  word: "approximately",
  display: "approximately",
  def: "大约、近似",
  defFull: "adv. 大约、近似",
  sentence: "There are approximately 1,670 stones.",
  source: "reading",
  state: STATE.REVIEW,
};

test("要会写：先输入并核对，拼对才按记得排期", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);

  expect(screen.getByText("_".repeat(13))).toBeInTheDocument();
  expect(screen.queryByText("approximately")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("大约、近似"));
  expect(screen.queryByText("approximately")).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "Approximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  expect(screen.getByRole("status")).toHaveTextContent("拼写正确");
  fireEvent.click(screen.getByRole("button", { name: "记得，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.GOOD, expect.any(Number));
});

test("拼错或主动看答案都按忘了排期", () => {
  const onGrade = jest.fn(() => null);
  const { rerender } = render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.submit(screen.getByRole("button", { name: "核对拼写" }).closest("form"));
  expect(screen.getByRole("status")).toHaveTextContent("aproximately");
  fireEvent.click(screen.getByRole("button", { name: "忘了，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));

  onGrade.mockClear();
  rerender(<VocabReview key="second" initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
  fireEvent.click(screen.getByRole("button", { name: "忘了，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
});

test("只需认得的词仍可翻面并自评，不要求输入拼写", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[{ ...card, productive: false }]} onGrade={onGrade} onExit={jest.fn()} />);
  expect(screen.queryByRole("textbox", { name: "拼写英文单词" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  fireEvent.click(screen.getByRole("button", { name: /记得/ }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.GOOD, expect.any(Number));
});
