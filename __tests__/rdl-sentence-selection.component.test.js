/**
 * RDLTask · 真题学术阅读「选句题」（sentence_selection）交互契约。
 *
 * 数据契约见 lib/reading/sentenceSelection.js；fixture 取自真题 real_ap_128a_1_27 的真实段落，
 * 第 29 题（第 4 段选句）是按契约手造的（__tests__/fixtures/real-ap-sentence-selection.json）。
 * 挂的是 app/real-bank/page.js 同款适配对象（passage→text、topic→genre），不是复刻页。
 *
 * 锁的事：
 *   1. 左栏第 N 段逐句可点（role=button、可 Tab/Enter），其余正文不可点；
 *   2. 右栏：题干 + 「点击左侧文章第 N 段中的一句作答」+「已选：…/尚未选择」，可改选；
 *   3. 已作答计数 / 草稿恢复 / 上一题下一题照常，提交判分与四选一同口径（answer === correct_answer）；
 *   4. 复盘：正确句绿底、选错的句红底，右栏写出正确句原文；
 *   5. 原图条目：选句题强制显示文字，换到别的题原图照旧；
 *   6. 词汇高亮与可点句子共存；定位不到时右栏列表兜底（不出死题）；切到本题把第 N 段滚进视口。
 */
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { RDLTask } from "../components/reading/RDLTask";
import FIXTURE from "./fixtures/real-ap-sentence-selection.json";

const noop = () => {};
const [RAW_PLAIN, RAW_IMG] = FIXTURE.items;
// 与 app/real-bank/page.js 的 apAsRdl 同一个适配口径。
const asRdl = (raw) => ({ ...raw, text: raw.passage, genre: raw.topic });
const PLAIN = asRdl(RAW_PLAIN);
const WITH_IMAGE = asRdl(RAW_IMG);
const SS = RAW_PLAIN.questions[2];

const sentenceEls = (container) => Array.from(container.querySelectorAll("[data-ss-key]"));
const sentenceEl = (container, key) => container.querySelector(`[data-ss-key="${key}"]`);

function renderTask(item = PLAIN, props = {}) {
  return render(
    <RDLTask item={item} onExit={noop} onComplete={noop} isPractice title="Academic Passage" section="Reading | Task 3" {...props} />
  );
}

function goToQuestion(n) {
  fireEvent.click(screen.getByRole("button", { name: String(n) }));
}

// 提交后圆点显示 ✓ / ✗ 而不是题号，且会回到第 1 题 —— 复盘时用「下一题」往后翻。
function reviewGoToQuestion(n) {
  for (let i = 1; i < n; i += 1) fireEvent.click(screen.getByText("下一题 →"));
}

beforeEach(() => {
  localStorage.clear();
});

describe("RDLTask 选句题：作答", () => {
  test("fixture 自洽：第 29 题是题干第 4 段选句（paragraphs[0] 是标题 → paragraph_index 4），四句都是该段原文子串", () => {
    expect(SS.question_type).toBe("sentence_selection");
    expect(SS.paragraph).toBe(4);
    expect(SS.paragraph_index).toBe(4);
    Object.values(SS.options).forEach((s) => expect(RAW_PLAIN.paragraphs[SS.paragraph_index]).toContain(s));
  });

  test("非选句题时正文照旧不可点（与改动前一致）", () => {
    const { container } = renderTask();
    expect(sentenceEls(container)).toHaveLength(0);
    expect(screen.queryByTestId("ss-answer-panel")).toBeNull();
    expect(screen.getByText("By disrupting the path of sound waves")).toBeInTheDocument();
  });

  test("切到选句题：第 4 段每一句可点（role=button + tabIndex），其余段落不可点；右栏提示第 4 段", () => {
    const { container } = renderTask();
    goToQuestion(3);

    const els = sentenceEls(container);
    expect(els.map((el) => el.getAttribute("data-ss-key"))).toEqual(["S1", "S2", "S3", "S4"]);
    els.forEach((el, i) => {
      expect(el).toHaveAttribute("role", "button");
      expect(el).toHaveAttribute("tabindex", "0");
      expect(el).toHaveAttribute("aria-pressed", "false");
      expect(el.textContent).toBe(SS.options[`S${i + 1}`]);
      // 查词层不许在作答时被点句子触发
      expect(el).toHaveAttribute("data-no-dict");
    });
    // 第 1 段那句不在任何可点句子里
    const para1 = "Urban areas across the globe are grappling with the challenge of noise pollution.";
    expect(els.some((el) => el.textContent.includes(para1))).toBe(false);
    expect(container.textContent).toContain(para1);
    // 段落包裹层标了展示段号与定位下标（滚动定位用）
    expect(screen.getByTestId("ss-paragraph")).toHaveAttribute("data-paragraph", "4");
    expect(screen.getByTestId("ss-paragraph")).toHaveAttribute("data-paragraph-index", "4");

    const panel = screen.getByTestId("ss-answer-panel");
    expect(within(panel).getByText("点击左侧文章第 4 段中的一句作答")).toBeInTheDocument();
    expect(within(panel).getByText("尚未选择")).toBeInTheDocument();
    expect(screen.getByText(SS.stem)).toBeInTheDocument();
    expect(screen.getByText("(选句)")).toBeInTheDocument();
    // 选句题不渲染四选一的 A-D 列表
    expect(screen.queryByText("By disrupting the path of sound waves")).toBeNull();
  });

  test("点句子 → 已选：原句 + 实底高亮 + 已作答计数；再点另一句 = 改选", () => {
    const { container } = renderTask();
    goToQuestion(3);
    expect(screen.getByText("已作答 0/3")).toBeInTheDocument();

    fireEvent.click(sentenceEl(container, "S3"));
    const panel = screen.getByTestId("ss-answer-panel");
    expect(within(panel).getByText("已选：")).toBeInTheDocument();
    expect(within(panel).getByText(SS.options.S3)).toBeInTheDocument();
    expect(sentenceEl(container, "S3")).toHaveAttribute("aria-pressed", "true");
    expect(sentenceEl(container, "S3")).toHaveAttribute("data-ss-state", "selected");
    expect(sentenceEl(container, "S3").style.background).toBe("rgb(59, 130, 246)");
    expect(screen.getByText("已作答 1/3")).toBeInTheDocument();

    fireEvent.click(sentenceEl(container, "S1"));
    expect(within(panel).getByText(SS.options.S1)).toBeInTheDocument();
    expect(within(panel).queryByText(SS.options.S3)).toBeNull();
    expect(sentenceEl(container, "S1")).toHaveAttribute("aria-pressed", "true");
    expect(sentenceEl(container, "S3")).toHaveAttribute("aria-pressed", "false");
    // 改选不重复计数
    expect(screen.getByText("已作答 1/3")).toBeInTheDocument();
  });

  test("悬停淡高亮；键盘 Enter / 空格可选", () => {
    const { container } = renderTask();
    goToQuestion(3);

    fireEvent.mouseEnter(sentenceEl(container, "S2"));
    expect(sentenceEl(container, "S2")).toHaveAttribute("data-ss-state", "hover");
    expect(sentenceEl(container, "S2").style.background).toBe("rgb(239, 246, 255)");
    fireEvent.mouseLeave(sentenceEl(container, "S2"));
    expect(sentenceEl(container, "S2")).toHaveAttribute("data-ss-state", "idle");

    fireEvent.keyDown(sentenceEl(container, "S4"), { key: "Enter" });
    expect(sentenceEl(container, "S4")).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(sentenceEl(container, "S2"), { key: " " });
    expect(sentenceEl(container, "S2")).toHaveAttribute("aria-pressed", "true");
    expect(sentenceEl(container, "S4")).toHaveAttribute("aria-pressed", "false");
  });

  test("上一题 / 下一题来回切，选句保留；圆点显示已作答", () => {
    const { container } = renderTask();
    goToQuestion(3);
    fireEvent.click(sentenceEl(container, "S2"));

    fireEvent.click(screen.getByText("← 上一题"));
    expect(sentenceEls(container)).toHaveLength(0);
    // 当前题是第 2 题，第 3 题圆点是「已作答」浅底
    expect(screen.getByRole("button", { name: "3" }).style.background).toBe("rgb(239, 246, 255)");

    fireEvent.click(screen.getByText("下一题 →"));
    expect(sentenceEl(container, "S2")).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("ss-answer-panel")).getByText(SS.options.S2)).toBeInTheDocument();
  });

  test("草稿里的 S 键能恢复（刷新后已选句子还在）", () => {
    localStorage.setItem(`tp-draft:rdl:${PLAIN.id}`, JSON.stringify({ selections: [null, null, "S4"], currentQ: 2 }));
    const { container } = renderTask();
    expect(sentenceEl(container, "S4")).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("ss-answer-panel")).getByText(SS.options.S4)).toBeInTheDocument();
    expect(screen.getByText("已作答 1/3")).toBeInTheDocument();
  });
});

describe("RDLTask 选句题：定位按 paragraph_index，题干段号只管展示", () => {
  // 同一篇去掉标题段：paragraphs[0] 就是正文第 1 段 —— 题干「第 4 段」= paragraph_index 3。
  const BODY = RAW_PLAIN.paragraphs.slice(1);
  const noTitleItem = (ssPatch) => asRdl({
    ...RAW_PLAIN,
    id: "real_ap_fixture_notitle_1",
    passage: BODY.join("\n\n"),
    paragraphs: BODY,
    questions: [{ ...SS, ...ssPatch }],
  });

  test("paragraphs[0] 不是标题：paragraph=4 / paragraph_index=3 → 圈的是正文第 4 段，提示写第 4 段，可作答", () => {
    const { container } = renderTask(noTitleItem({ paragraph: 4, paragraph_index: 3 }));
    const para = screen.getByTestId("ss-paragraph");
    expect(para).toHaveAttribute("data-paragraph", "4");
    expect(para).toHaveAttribute("data-paragraph-index", "3");
    expect(para.textContent).toBe(BODY[3]);
    expect(sentenceEls(container).map((el) => el.textContent)).toEqual(Object.values(SS.options));
    expect(within(screen.getByTestId("ss-answer-panel")).getByText("点击左侧文章第 4 段中的一句作答")).toBeInTheDocument();

    expect(screen.getByText("已作答 0/1")).toBeInTheDocument();
    fireEvent.click(sentenceEl(container, "S2"));
    expect(sentenceEl(container, "S2")).toHaveAttribute("aria-pressed", "true");
    // 唯一一题答完：计数位变成「可以提交」
    expect(screen.getByText("可以提交")).toBeInTheDocument();
  });

  test("同一篇按题干段号当下标（paragraph_index=4，越界）→ 不圈句子，右栏逐句列表兜底", () => {
    const { container } = renderTask(noTitleItem({ paragraph: 4, paragraph_index: 4 }));
    expect(sentenceEls(container)).toHaveLength(0);
    expect(screen.queryByTestId("ss-answer-panel")).toBeNull();
    expect(screen.getByRole("button", { name: SS.options.S2 })).toBeInTheDocument();
  });

  test("paragraph_index 指到别的段 → 列表兜底；不会因为 paragraph=4 恰好对得上就去圈第 4 段", () => {
    const { container } = renderTask(asRdl({ ...RAW_PLAIN, questions: [{ ...SS, paragraph: 4, paragraph_index: 3 }] }));
    expect(sentenceEls(container)).toHaveLength(0);
    expect(screen.queryByTestId("ss-answer-panel")).toBeNull();
  });

  test("兼容：没带 paragraph_index 的题（没经过 mapper）按旧口径 paragraphs[paragraph] 定位", () => {
    const { paragraph_index: _drop, ...legacy } = SS;
    const { container } = renderTask(asRdl({ ...RAW_PLAIN, questions: [legacy] }));
    expect(sentenceEls(container)).toHaveLength(4);
    expect(screen.getByTestId("ss-paragraph")).toHaveAttribute("data-paragraph-index", "4");
  });
});

describe("RDLTask 选句题：提交与复盘", () => {
  function answerAll(container, ssKey) {
    fireEvent.click(screen.getByText("By disrupting the path of sound waves"));
    fireEvent.click(screen.getByText("下一题 →"));
    fireEvent.click(screen.getByText("struggling"));
    fireEvent.click(screen.getByText("下一题 →"));
    fireEvent.click(sentenceEl(container, ssKey));
    fireEvent.click(screen.getByText("提交全部"));
  }

  test("判分与四选一同口径：选错句 → isCorrect=false，correct=2/3", () => {
    const onComplete = jest.fn();
    const { container } = renderTask(PLAIN, { onComplete });
    answerAll(container, "S3");
    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.correct).toBe(2);
    expect(payload.total).toBe(3);
    expect(payload.results[2]).toEqual({ selected: "S3", correct: "S2", isCorrect: false });
  });

  test("选对句 → isCorrect=true", () => {
    const onComplete = jest.fn();
    const { container } = renderTask(PLAIN, { onComplete });
    answerAll(container, "S2");
    expect(onComplete.mock.calls[0][0].results[2]).toEqual({ selected: "S2", correct: "S2", isCorrect: true });
    expect(onComplete.mock.calls[0][0].correct).toBe(3);
  });

  test("复盘：正确句绿底、选错的句红底、句子不再可点；右栏写出正确句与你选的句", () => {
    const { container } = renderTask();
    answerAll(container, "S3");
    // 提交后回到第 1 题；翻到第 3 题看复盘
    reviewGoToQuestion(3);
    expect(sentenceEl(container, "S2")).toHaveAttribute("data-ss-state", "correct");
    expect(sentenceEl(container, "S2").style.background).toBe("rgb(209, 250, 229)");
    expect(sentenceEl(container, "S3")).toHaveAttribute("data-ss-state", "wrong");
    expect(sentenceEl(container, "S3").style.background).toBe("rgb(254, 226, 226)");
    expect(sentenceEl(container, "S1")).toHaveAttribute("data-ss-state", "review");
    sentenceEls(container).forEach((el) => expect(el).not.toHaveAttribute("role"));

    // 复盘时再点句子不改答案
    fireEvent.click(sentenceEl(container, "S1"));
    expect(sentenceEl(container, "S1")).toHaveAttribute("data-ss-state", "review");

    const review = screen.getByTestId("ss-review");
    expect(within(review).getByText("回答错误")).toBeInTheDocument();
    expect(within(review).getByText("正确句：")).toBeInTheDocument();
    expect(within(review).getByText(SS.options.S2)).toBeInTheDocument();
    expect(within(review).getByText("你选的：")).toBeInTheDocument();
    expect(within(review).getByText(SS.options.S3)).toBeInTheDocument();
    expect(screen.queryByTestId("ss-answer-panel")).toBeNull();
  });

  test("复盘答对：只写正确句，不出现「你选的」", () => {
    const { container } = renderTask();
    answerAll(container, "S2");
    reviewGoToQuestion(3);
    const review = screen.getByTestId("ss-review");
    expect(within(review).getByText("回答正确")).toBeInTheDocument();
    expect(within(review).queryByText("你选的：")).toBeNull();
    expect(within(review).getByText(SS.options.S2)).toBeInTheDocument();
  });
});

describe("RDLTask 选句题：原图 / 词汇高亮 / 兜底 / 滚动", () => {
  test("原图条目：四选一题显图；选句题强制显示文字且句子可点；切回别的题原图照旧", () => {
    const { container } = renderTask(WITH_IMAGE);
    expect(screen.getByRole("img")).toBeInTheDocument();

    goToQuestion(3);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("本题需要在文章里点选句子，已切换为文字")).toBeInTheDocument();
    expect(screen.queryByText("查看原图")).toBeNull();
    expect(screen.queryByText("切换为文字")).toBeNull();
    expect(sentenceEls(container)).toHaveLength(4);
    fireEvent.click(sentenceEl(container, "S2"));
    expect(sentenceEl(container, "S2")).toHaveAttribute("aria-pressed", "true");

    goToQuestion(1);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  test("词汇题照常高亮目标词；词汇高亮与可点句子能共存（同一题两者都生效）", () => {
    const { container } = renderTask();
    goToQuestion(2);
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark.textContent).toBe("grappling");
    expect(sentenceEls(container)).toHaveLength(0);

    // 同一道选句题带 target_word（getVocabTargetWord 优先读它）→ 句子可点 + 句内词高亮
    const both = { ...PLAIN, questions: [{ ...SS, target_word: "materials" }] };
    const { container: c2 } = render(<RDLTask item={both} onExit={noop} onComplete={noop} isPractice />);
    const s1 = sentenceEl(c2, "S1");
    expect(s1).toHaveAttribute("role", "button");
    expect(within(s1).getByText("materials").tagName).toBe("MARK");
    fireEvent.click(s1);
    expect(sentenceEl(c2, "S1")).toHaveAttribute("aria-pressed", "true");
  });

  test("句子在正文里定位不到 → 右栏逐句列表兜底，仍可作答判分，复盘写出正确句", () => {
    const broken = {
      ...PLAIN,
      questions: [{ ...SS, options: { ...SS.options, S3: "This sentence is not in the passage." } }],
    };
    const onComplete = jest.fn();
    const { container } = render(<RDLTask item={broken} onExit={noop} onComplete={onComplete} isPractice />);
    expect(sentenceEls(container)).toHaveLength(0);
    expect(screen.queryByTestId("ss-answer-panel")).toBeNull();
    // 右栏把四句列出来当选项
    fireEvent.click(screen.getByText(SS.options.S2));
    fireEvent.click(screen.getByText("提交全部"));
    expect(onComplete.mock.calls[0][0].results[0]).toEqual({ selected: "S2", correct: "S2", isCorrect: true });
    expect(within(screen.getByTestId("ss-review")).getByText("回答正确")).toBeInTheDocument();
  });

  test("切到选句题时把第 4 段滚进左栏视口（只滚左栏容器）；整段已在视口内则不滚", () => {
    const scrollTo = jest.fn();
    const rectOf = (el) => {
      if (el.classList && el.classList.contains("tp-reading-left")) return { top: 100, bottom: 500, height: 400 };
      if (el.getAttribute && el.getAttribute("data-testid") === "ss-paragraph") return { top: 900, bottom: 1000, height: 100 };
      return { top: 0, bottom: 0, height: 0 };
    };
    const origRect = Element.prototype.getBoundingClientRect;
    const origScrollTo = Element.prototype.scrollTo;
    Element.prototype.getBoundingClientRect = function mockRect() { return rectOf(this); };
    Element.prototype.scrollTo = scrollTo;
    try {
      const { container } = renderTask();
      expect(scrollTo).not.toHaveBeenCalled();
      goToQuestion(3);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      // scrollTop(0) + (900 - 100) - 16
      expect(scrollTo).toHaveBeenCalledWith({ top: 784, behavior: "smooth" });
      expect(scrollTo.mock.contexts[0]).toBe(container.querySelector(".tp-reading-left"));
    } finally {
      Element.prototype.getBoundingClientRect = origRect;
      Element.prototype.scrollTo = origScrollTo;
    }
  });

  test("段落已在视口内：不滚", () => {
    const scrollTo = jest.fn();
    const origRect = Element.prototype.getBoundingClientRect;
    const origScrollTo = Element.prototype.scrollTo;
    Element.prototype.getBoundingClientRect = function mockRect() {
      if (this.classList && this.classList.contains("tp-reading-left")) return { top: 100, bottom: 500 };
      return { top: 200, bottom: 300 };
    };
    Element.prototype.scrollTo = scrollTo;
    try {
      renderTask();
      act(() => { goToQuestion(3); });
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      Element.prototype.getBoundingClientRect = origRect;
      Element.prototype.scrollTo = origScrollTo;
    }
  });
});
