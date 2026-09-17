import { countUnseenReplies, repliedIds, loadSeenReplyIds, saveSeenReplyIds, FEEDBACK_SEEN_KEY } from "../lib/feedback/replySeen";

describe("反馈回复未读计数（lib/feedback/replySeen）", () => {
  const rows = [
    { id: 1, content: "a", admin_reply: "已修复" },
    { id: 2, content: "b", admin_reply: "   " },
    { id: 3, content: "c", admin_reply: null },
    { id: 4, content: "d", admin_reply: "谢谢反馈" },
  ];

  test("repliedIds 只认非空回复", () => {
    expect(repliedIds(rows)).toEqual(["1", "4"]);
    expect(repliedIds(null)).toEqual([]);
  });

  test("countUnseenReplies 扣掉已读（id 类型不敏感）", () => {
    expect(countUnseenReplies(rows, [])).toBe(2);
    expect(countUnseenReplies(rows, [1])).toBe(1);
    expect(countUnseenReplies(rows, ["1", "4"])).toBe(0);
  });

  test("localStorage 读写往返，坏数据回退空数组", () => {
    window.localStorage.removeItem(FEEDBACK_SEEN_KEY);
    expect(loadSeenReplyIds()).toEqual([]);
    saveSeenReplyIds([1, "1", 2]);
    expect(loadSeenReplyIds()).toEqual(["1", "2"]);
    window.localStorage.setItem(FEEDBACK_SEEN_KEY, "{not json");
    expect(loadSeenReplyIds()).toEqual([]);
  });
});
