import { render, screen, fireEvent } from "@testing-library/react";
import { RDLTask } from "../components/reading/RDLTask";

/**
 * 真题阅读「材料框原图」的渲染契约（2026-09-07）。
 *
 * 两件必须锁死的事：
 *   1) 有 material_image 时默认显图 + 可切回文字（真题界面的版面在纯文本里是丢掉的）；
 *   2) **没有**该字段时输出与从前完全一致 —— app/reading/page.js 与个人题库
 *      （lib/userBank/personalBank.js）也走 RDLTask，它们的 item 永远没有这个字段。
 */
const SUPA = "https://abc123.supabase.co/storage/v1/object/public/real_bank_images/reading/real_rdl_310_1_23.webp";

const baseItem = {
  id: "real_rdl_310_1_23",
  genre: "poster",
  text: "Springfield Community Wellness Classes\n\nGuided stretching sessions every Saturday.",
  questions: [
    {
      question_type: "detail",
      stem: "What is indicated about the special sessions?",
      options: { A: "Twice a month", B: "Required", C: "Free for anyone", D: "Cancelled" },
      correct_answer: "C",
    },
  ],
};

const withImage = { ...baseItem, material_image: { url: SUPA, w: 535, h: 341 } };

const vocabItem = {
  ...withImage,
  questions: [
    {
      question_type: "vocabulary",
      stem: 'The word "guided" in the passage is closest in meaning to',
      options: { A: "led", B: "lost", C: "loud", D: "long" },
      correct_answer: "A",
    },
  ],
};

const noop = () => {};

describe("RDLTask 材料原图", () => {
  test("有 material_image → 默认渲染 img，指向同源代理", () => {
    render(<RDLTask item={withImage} onExit={noop} onComplete={noop} isPractice />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/api/img/reading/real_rdl_310_1_23.webp");
    expect(img.getAttribute("alt")).toContain("poster");
    // 图模式下不渲染材料正文
    expect(screen.queryByText(/Guided stretching sessions/)).toBeNull();
  });

  test("「切换为文字」→ 显示原文；「查看原图」→ 切回图", () => {
    render(<RDLTask item={withImage} onExit={noop} onComplete={noop} isPractice />);
    fireEvent.click(screen.getByText("切换为文字"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/Guided stretching sessions/)).toBeTruthy();

    fireEvent.click(screen.getByText("查看原图"));
    expect(screen.getByRole("img")).toBeTruthy();
  });

  test("词汇题 + 图模式 → 给一行提示，但不自动切换", () => {
    render(<RDLTask item={vocabItem} onExit={noop} onComplete={noop} isPractice />);
    expect(screen.getByText("本题考查词汇，可切换为文字查看高亮")).toBeTruthy();
    expect(screen.getByRole("img")).toBeTruthy();
  });

  test("没有 material_image → 无 img、无切换按钮，正文照旧渲染（老库零变化）", () => {
    render(<RDLTask item={baseItem} onExit={noop} onComplete={noop} isPractice />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("切换为文字")).toBeNull();
    expect(screen.queryByText("查看原图")).toBeNull();
    expect(screen.getByText(/Guided stretching sessions/)).toBeTruthy();
  });

  test("题目仍然可作答判分（图模式不影响右栏交互）", () => {
    const onComplete = jest.fn();
    render(<RDLTask item={withImage} onExit={noop} onComplete={onComplete} isPractice />);
    fireEvent.click(screen.getByText("Free for anyone"));
    fireEvent.click(screen.getByText("提交全部"));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ correct: 1, total: 1 })
    );
  });
});
