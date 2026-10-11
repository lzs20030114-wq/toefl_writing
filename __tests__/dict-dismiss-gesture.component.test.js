import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";
import { lookupWord } from "../lib/dict/lookup";

jest.mock("../lib/dict/lookup", () => ({
  lookupWord: jest.fn(), normalizeWord: (word) => word.toLowerCase(), prefetchShards: jest.fn(),
}));
const rect = Range.prototype.getBoundingClientRect;
beforeEach(() => {
  localStorage.clear();
  lookupWord.mockReset().mockResolvedValue({ word: "apple", t: "n. 苹果" });
  Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 40, width: 60, height: 20 });
});
afterEach(() => { Range.prototype.getBoundingClientRect = rect; });
function mount() {
  const control = jest.fn();
  render(<><WordLookupLayer><span data-dict-word="apple">apple</span><span data-dict-word="pear">pear</span>
    <button data-no-dict onClick={control}>播放</button><span>空白</span></WordLookupLayer>
    <WordLookupLayer><span data-dict-word="orange">orange</span></WordLookupLayer></>);
  return control;
}
function click(target) {
  fireEvent.mouseDown(target);
  fireEvent.mouseUp(target);
  fireEvent.click(target);
}
async function open() {
  click(screen.getByText("apple"));
  await screen.findByRole("button", { name: "收藏到单词本" });
}
test.each(["pear", "orange", "空白"])("点击%s优先关闭；后续新手势可查词", async (target) => {
  mount(); await open();
  click(screen.getByText(target));
  expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  expect(lookupWord).toHaveBeenCalledTimes(1);
  click(screen.getByText(target === "空白" ? "pear" : target));
  await screen.findByRole("button", { name: "关闭" });
  expect(lookupWord).toHaveBeenCalledTimes(2);
});
test("内部按钮及外部 data-no-dict 控件动作保留", async () => {
  const control = mount(); await open();
  click(screen.getByRole("button", { name: "听力词" }));
  expect(screen.getByRole("button", { name: "听力词" })).toHaveAttribute("aria-pressed", "true");
  click(screen.getByText("播放"));
  expect(control).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
});
test("触摸关闭后延迟选词与兼容鼠标事件均不打开新词", async () => {
  jest.useFakeTimers();
  try {
    mount(); await open();
    const target = screen.getByText("orange");
    fireEvent.touchStart(target);
    fireEvent.touchEnd(target, { changedTouches: [{ clientX: 40, clientY: 110 }] });
    act(() => jest.advanceTimersByTime(10));
    click(target);
    expect(lookupWord).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    await act(async () => click(target));
    expect(lookupWord).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});
test("首次触摸查词只查一次；新手势使未执行的触摸回调失效", async () => {
  jest.useFakeTimers();
  try {
    mount();
    const apple = screen.getByText("apple");
    fireEvent.touchStart(apple);
    fireEvent.touchEnd(apple, { changedTouches: [{ clientX: 40, clientY: 110 }] });
    await act(async () => jest.advanceTimersByTime(10));
    click(apple);
    expect(lookupWord).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.touchStart(apple);
    fireEvent.touchEnd(apple, { changedTouches: [{ clientX: 40, clientY: 110 }] });
    // 触摸的兼容 click 已结束后，用户马上开始一个真实的新触摸。
    click(apple);
    fireEvent.touchStart(screen.getByText("orange"));
    act(() => jest.advanceTimersByTime(10));
    expect(lookupWord).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  } finally { jest.useRealTimers(); }
});
test("弹窗关闭钮的触摸延迟不能穿透到背后重新查词", async () => {
  jest.useFakeTimers();
  try {
    mount(); await open();
    const button = screen.getByRole("button", { name: "关闭" });
    fireEvent.touchStart(button);
    fireEvent.touchEnd(button, { changedTouches: [{ clientX: 40, clientY: 110 }] });
    click(button);
    act(() => jest.advanceTimersByTime(10));
    expect(lookupWord).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  } finally { jest.useRealTimers(); }
});
test("旧触摸回调不能关闭后续真实鼠标手势打开的新词", async () => {
  jest.useFakeTimers();
  try {
    mount();
    const apple = screen.getByText("apple");
    const orange = screen.getByText("orange");
    fireEvent.touchStart(apple);
    fireEvent.touchEnd(apple, { changedTouches: [{ clientX: 40, clientY: 110 }] });
    click(apple);
    const pointer = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(pointer, "pointerType", { value: "mouse" });
    fireEvent(orange, pointer);
    await act(async () => click(orange));
    expect(lookupWord).toHaveBeenCalledTimes(1);
    expect(lookupWord).toHaveBeenLastCalledWith("orange");
    const popup = screen.getByRole("button", { name: "关闭" }).parentElement.parentElement;
    await act(async () => jest.advanceTimersByTime(10));
    expect(lookupWord).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "关闭" }).parentElement.parentElement).toBe(popup);
  } finally { jest.useRealTimers(); }
});
test("Escape关闭后在途查询不能复活弹窗", async () => {
  let resolve;
  lookupWord.mockImplementation(() => new Promise((done) => { resolve = done; }));
  mount(); click(screen.getByText("apple"));
  fireEvent.keyDown(document, { key: "Escape" });
  await act(async () => resolve({ word: "apple", t: "n. 苹果" }));
  expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
});
