import { fireEvent, render, screen } from "@testing-library/react";
import { VocabReview } from "../components/vocab/VocabReview";
import { ListeningVocabReview } from "../components/vocab/ListeningVocabReview";
import { STATE } from "../lib/vocab/srs";
import { cancelSpeakWord, preloadSpeakWords, speakWord } from "../lib/audio/speakWord";
jest.mock("../lib/audio/speakWord", () => ({
  canSpeak: jest.fn(() => true),
  cancelSpeakWord: jest.fn(),
  speakWord: jest.fn(() => true),
  preloadSpeakWords: jest.fn()
}));
const make = word => ({
  word,
  display: word,
  def: "n. 测试",
  productive: false,
  state: STATE.NEW
});
let release;
beforeEach(() => {
  jest.clearAllMocks();
  release = jest.fn();
  preloadSpeakWords.mockReturnValue(release);
});
const grade = () => {
  fireEvent.click(screen.getByRole("button", {
    name: /显示答案/
  }));
  fireEvent.click(screen.getByRole("button", {
    name: /^记得/
  }));
};
test("阅读初始和下一词自动播一次，翻面统计更新撤销不重播，退出释放预加载", () => {
  const queue = [make("apple"), make("forest")];
  const onGrade = jest.fn(word => ({
    ...make(word),
    state: STATE.REVIEW,
    due: new Date(Date.now() + 86400000).toISOString()
  }));
  const props = {
    initialQueue: queue,
    onGrade,
    onUndo: () => ({}),
    onExit: jest.fn()
  };
  const {
    rerender,
    unmount
  } = render(<VocabReview {...props} />);
  expect(preloadSpeakWords).toHaveBeenCalledWith(["apple", "forest"]);
  expect(speakWord).toHaveBeenCalledTimes(1);
  rerender(<VocabReview {...props} statsNow={{
    total: 2
  }} />);
  expect(speakWord).toHaveBeenCalledTimes(1);
  grade();
  expect(speakWord).toHaveBeenCalledTimes(2);
  expect(speakWord).toHaveBeenLastCalledWith("forest", {});
  fireEvent.click(screen.getByRole("button", {
    name: /撤销上一张/
  }));
  expect(speakWord).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", {
    name: /退出/
  }));
  expect(release).toHaveBeenCalledTimes(1);
  expect(cancelSpeakWord).toHaveBeenCalled();
  unmount();
  expect(release).toHaveBeenCalledTimes(1);
});
test("暂停移除当前词后同一队列位置的新词会自动播", () => {
  render(<VocabReview initialQueue={[make("apple"), make("forest")]} onGrade={() => null} onSuspend={() => ({})} onExit={() => {}} />);
  fireEvent.click(screen.getByRole("button", {
    name: "更多操作"
  }));
  fireEvent.click(screen.getByRole("menuitem", {
    name: "暂停复习这个词"
  }));
  expect(speakWord).toHaveBeenCalledTimes(2);
  expect(speakWord).toHaveBeenLastCalledWith("forest", {});
});
test("阅读发音失败不影响翻面评分", () => {
  speakWord.mockReturnValueOnce(false);
  const onGrade = jest.fn(() => null);
  render(<VocabReview initialQueue={[make("apple")]} onGrade={onGrade} onExit={() => {}} />);
  grade();
  expect(onGrade).toHaveBeenCalled();
});
test("听力开场后台预载整个队列且卸载释放", () => {
  const {
    unmount
  } = render(<ListeningVocabReview initialQueue={[make("apple"), make("forest")]} onGrade={() => null} onExit={() => {}} />);
  expect(preloadSpeakWords).toHaveBeenCalledWith(["apple", "forest"]);
  unmount();
  expect(release).toHaveBeenCalledTimes(1);
});
test("阅读分段停播，继续才播下一词，完成释放预加载", () => {
  const queue = Array.from({
    length: 11
  }, (_, i) => make("word" + i));
  const onGrade = word => ({
    ...make(word),
    state: STATE.REVIEW,
    due: new Date(Date.now() + 86400000).toISOString()
  });
  render(<VocabReview initialQueue={queue} onGrade={onGrade} onExit={() => {}} />);
  for (let i = 0; i < 10; i++) grade();
  expect(speakWord).toHaveBeenCalledTimes(10);
  fireEvent.click(screen.getByRole("button", {
    name: /继续/
  }));
  expect(speakWord).toHaveBeenCalledTimes(11);
  grade();
  expect(speakWord).toHaveBeenCalledTimes(11);
  expect(release).toHaveBeenCalledTimes(1);
});
test("同一个词重新入队也按新的问题自动播放", () => {
  const queue = [make("apple"), ...Array.from({
    length: 10
  }, (_, i) => make("word" + i))];
  const onGrade = word => ({
    ...make(word),
    state: STATE.LEARNING,
    due: new Date(Date.now() + (word === "apple" ? 60000 : 86400000)).toISOString()
  });
  render(<VocabReview initialQueue={queue} onGrade={onGrade} onExit={() => {}} />);
  for (let i = 0; i < 10; i++) grade();
  fireEvent.click(screen.getByRole("button", {
    name: /继续/
  }));
  grade();
  expect(speakWord).toHaveBeenCalledTimes(12);
  expect(speakWord).toHaveBeenLastCalledWith("apple", {});
});
test("账户属性切换停止旧会话预载，旧队列不再次播放", () => {
  const props = {
    initialQueue: [make("apple")],
    onGrade: () => null,
    onExit: () => {}
  };
  const {
    rerender
  } = render(<VocabReview {...props} />);
  expect(speakWord).toHaveBeenCalledTimes(1);
  rerender(<VocabReview {...props} accountKey="different-account" />);
  expect(release).toHaveBeenCalledTimes(1);
  expect(speakWord).toHaveBeenCalledTimes(1);
  expect(preloadSpeakWords).toHaveBeenCalledTimes(1);
});
