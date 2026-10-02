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

/** 要会写的词：先认词翻面，选「记得」才弹拼写。 */
const toSpelling = () => {
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  fireEvent.click(screen.getByRole("button", { name: /记得，去拼写/ }));
};

test("要会写：正面先认词，选「记得」才弹拼写，拼对才按记得排期", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);

  // 正面和别的词一样是原句高亮认词，没有输入框
  expect(screen.getByText("认词")).toBeInTheDocument();
  expect(screen.getAllByText("approximately").length).toBeGreaterThan(0);
  expect(screen.queryByRole("textbox", { name: "拼写英文单词" })).not.toBeInTheDocument();

  toSpelling();
  // 拼写时词收起来，只给释义 + 挖空句；句子里的空就是作答处，一开始一个字母都没有
  expect(screen.getByText("拼写")).toBeInTheDocument();
  expect(screen.getByText(/There are/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "拼写英文单词" })).toHaveValue("");
  expect(screen.queryByText("approximately")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("大约、近似"));
  expect(screen.queryByText("approximately")).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "Approximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  expect(screen.getByRole("status")).toHaveTextContent("拼写正确");
  fireEvent.click(screen.getByRole("button", { name: "拼对了，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.GOOD, expect.any(Number));
});

test("拼写是一个字母一个格：敲的字母落在格子上，多敲的、空格标点都不进", () => {
  render(<VocabReview initialQueue={[card]} onGrade={jest.fn(() => null)} onExit={jest.fn()} />);
  toSpelling();
  const input = screen.getByRole("textbox", { name: "拼写英文单词" });
  fireEvent.change(input, { target: { value: "Appr ox!" } });
  expect(input).toHaveValue("approx");
  expect(screen.getByText(/已填/)).toHaveTextContent("已填 6 / 13 个字母");
  fireEvent.change(input, { target: { value: "approximatelyyy" } });
  expect(input).toHaveValue("approximately");
});

test("输入法组字中不改写输入框，组字结束再只留字母", () => {
  render(<VocabReview initialQueue={[card]} onGrade={jest.fn(() => null)} onExit={jest.fn()} />);
  toSpelling();
  const input = screen.getByRole("textbox", { name: "拼写英文单词" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "a'pr" } });
  expect(input).toHaveValue("a'pr");
  fireEvent.compositionEnd(input, { target: { value: "a'pr" } });
  expect(input).toHaveValue("apr");
});

test("拼错后正确拼写按格子摆出来，漏写的字母标红", () => {
  render(<VocabReview initialQueue={[card]} onGrade={jest.fn(() => null)} onExit={jest.fn()} />);
  toSpelling();
  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  const answer = screen.getByRole("group", { name: "正确拼写 approximately" });
  const red = [...answer.querySelectorAll("span")].filter((el) => el.style.color === "rgb(220, 38, 38)");
  expect(red.map((el) => el.textContent)).toEqual(["p"]);
});

test("要会写的词认词就选「忘了」：直接按忘了排期，不弹拼写", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  fireEvent.click(screen.getByRole("button", { name: /忘了/ }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
});

test("新词第一天只认词：选「记得」直接算记得，不弹拼写", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[{ ...card, state: STATE.NEW }]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  expect(screen.queryByRole("button", { name: /去拼写/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /记得/ }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.GOOD, expect.any(Number));
});

test("键盘：空格翻面 → 空格选记得进拼写 → 回车核对 → 空格下一词", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.keyDown(window, { key: " " });
  fireEvent.keyDown(window, { key: " " });
  const input = screen.getByRole("textbox", { name: "拼写英文单词" });
  expect(onGrade).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "approximately" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(window, { key: " " });
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.GOOD, expect.any(Number));
});

test("旧账号的同词评分回调在切换账号后不执行", () => {
  localStorage.setItem("toefl-user-code", "VOCABPROBEA");
  try {
    const onGrade = jest.fn(() => ({ ...card, due: new Date().toISOString() }));
    render(<VocabReview accountKey="VOCABPROBEA" initialQueue={[{ ...card, productive: false }]} onGrade={onGrade} onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
    localStorage.setItem("toefl-user-code", "VOCABPROBEB");
    fireEvent.click(screen.getByRole("button", { name: /记得/ }));
    expect(onGrade).not.toHaveBeenCalled();
  } finally { localStorage.removeItem("toefl-user-code"); }
});

test("认得但拼错、或拼写时主动看答案，都按没记住排期", () => {
  const onGrade = jest.fn(() => null);
  const { rerender } = render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);
  toSpelling();
  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.submit(screen.getByRole("button", { name: "核对拼写" }).closest("form"));
  expect(screen.getByRole("status")).toHaveTextContent("aproximately");
  fireEvent.click(screen.getByRole("button", { name: "没拼对，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));

  onGrade.mockClear();
  rerender(<VocabReview key="second" initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);
  toSpelling();
  fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
  fireEvent.click(screen.getByRole("button", { name: "没拼对，下一词" }));
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
  toSpelling();

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  expect(screen.getByRole("group", { name: "正确拼写 approximately" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "再拼一次（提示首字母）" }));
  expect(screen.getByText("首字母提示：a")).toBeInTheDocument();
  expect(screen.queryAllByText("approximately")).toHaveLength(0);
  expect(screen.getByRole("textbox", { name: "拼写英文单词" })).toHaveValue("");

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "approximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  expect(screen.getByRole("status")).toHaveTextContent("这次拼对了");
  fireEvent.click(screen.getByRole("button", { name: "没拼对，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
});

test("主动看答案后也能反复重练，仍只评分一次", () => {
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onExit={jest.fn()} />);
  toSpelling();

  fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
  fireEvent.click(screen.getByRole("button", { name: "再拼一次（提示首字母）" }));
  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  fireEvent.click(screen.getByRole("button", { name: "再拼一次（提示首字母）" }));
  expect(screen.getByRole("textbox", { name: "拼写英文单词" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
  fireEvent.click(screen.getByRole("button", { name: "没拼对，下一词" }));
  expect(onGrade).toHaveBeenCalledTimes(1);
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
});

test("拼写失败后可改为只需认得；短队列不提前回插，改动留待下次到期", () => {
  let productive = true;
  const onSetProductive = jest.fn((word, on) => {
    productive = on;
    return { ...card, productive: on };
  });
  const onGrade = jest.fn(() => ({ ...card, productive, due: new Date().toISOString() }));
  render(<VocabReview initialQueue={[card]} onGrade={onGrade} onSetProductive={onSetProductive} onExit={jest.fn()} />);
  toSpelling();

  fireEvent.change(screen.getByRole("textbox", { name: "拼写英文单词" }), { target: { value: "aproximately" } });
  fireEvent.click(screen.getByRole("button", { name: "核对拼写" }));
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  const toggle = screen.getByRole("switch", { name: "approximately需要会写" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  expect(onSetProductive).toHaveBeenCalledWith(card.word, false);
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(screen.getByText(/下次出现时生效；本次仍按当前题型计分/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "没拼对，下一词" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "没拼对，下一词" }));
  expect(onGrade).toHaveBeenCalledWith(card.word, RATING.AGAIN, expect.any(Number));
  expect(screen.queryByRole("textbox", { name: "拼写英文单词" })).not.toBeInTheDocument();
  expect(screen.getByText("这一轮复习完成")).toBeInTheDocument();
  expect(screen.getByText(/它们已排进学习步，到时间会自动回到复习里/)).toBeInTheDocument();
});

test("认词卡可改回要会写，点开关不会顺带翻面", () => {
  const onSetProductive = jest.fn((word, on) => ({ ...card, productive: on }));
  render(<VocabReview initialQueue={[{ ...card, productive: false }]} onGrade={jest.fn()} onSetProductive={onSetProductive} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("switch", { name: "approximately需要会写" }));
  expect(onSetProductive).toHaveBeenCalledWith(card.word, true);
  expect(screen.getByRole("switch", { name: "approximately需要会写" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: /显示答案/ })).toBeInTheDocument();
});
