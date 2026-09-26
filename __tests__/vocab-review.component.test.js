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

  expect(screen.getByText(`a${"_".repeat(12)}`)).toBeInTheDocument();
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

test("拼错后可用首字母提示再拼一次，重练拼对仍按首次结果排期", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  expect(screen.getAllByText("approximately").length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "再拼一次（提示首字母）" }));
  expect(screen.getByText("首字母提示：a")).toBeInTheDocument();
  expect(screen.getByText(`a${"_".repeat(12)}`)).toBeInTheDocument();
  expect(screen.queryAllByText("approximately")).toHaveLength(0);
  expect(screen.getByRole("textbox", { name: "拼写英文单词" })).toHaveValue("");

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "approximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  expect(screen.getByRole("status")).toHaveTextContent("这次拼对了");
  fireEvent.click(screen.getByRole("button", { name: "忘了，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
});

test("主动看答案后也能反复重练，仍只评分一次", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
  fireEvent.click(screen.getByRole("button", { name: "再拼一次（提示首字母）" }));
  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  fireEvent.click(screen.getByRole("button", { name: "再拼一次（提示首字母）" }));
  expect(screen.getByRole("textbox", { name: "拼写英文单词" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
  fireEvent.click(screen.getByRole("button", { name: "忘了，下一词" }));
  expect(onGrade).toHaveBeenCalledTimes(1);
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
});

test("拼写失败后可改为只需认得，本次仍按拼错计分，下次出现改考认词", () => {
  let productive = true;
  const onSetProductive = jest.fn((word, on) => {
    productive = on;
    return { ...card, productive: on };
  });
  const onGrade = jest.fn(() => ({ ...card, productive, due: new Date().toISOString() }));
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onSetProductive={onSetProductive} onExit={jest.fn()} />);

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  const toggle = screen.getByRole("switch", { name: "approximately需要会写" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  expect(onSetProductive).toHaveBeenCalledWith(card.word, false);
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(screen.getByText(/下次出现时生效；本次仍按当前题型计分/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "忘了，下一词" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "忘了，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
  expect(screen.queryByRole("textbox", { name: "拼写英文单词" })).not.toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "approximately需要会写" })).toHaveAttribute("aria-checked", "false");
});

test("认词卡可改回要会写，点开关不会顺带翻面", () => {
  const onSetProductive = jest.fn((word, on) => ({ ...card, productive: on }));
  render(<VocabReview initialQueue={[{ ...card, productive: false }]} onGrade={jest.fn()} onSetProductive={onSetProductive} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("switch", { name: "approximately需要会写" }));
  expect(onSetProductive).toHaveBeenCalledWith(card.word, true);
  expect(screen.getByRole("switch", { name: "approximately需要会写" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: /显示答案/ })).toBeInTheDocument();
});
