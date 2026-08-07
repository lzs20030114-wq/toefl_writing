import { buildFeedbackReplyEmail } from "../lib/mail/templates/feedbackReply";

describe("buildFeedbackReplyEmail", () => {
  const base = {
    userCode: "ABC123",
    feedbackContent: "听力音频加载很慢，能不能优化一下？",
    feedbackDate: "2026-08-01T10:00:00Z",
    replyContent: "已经修复了，音频改走同源代理，现在国内加载应该秒开。",
  };

  it("builds a subject mentioning the reply", () => {
    const { subject } = buildFeedbackReplyEmail(base);
    expect(subject).toContain("反馈");
    expect(subject).toContain("TreePractice");
  });

  it("includes user code, original feedback, and reply in text body", () => {
    const { text } = buildFeedbackReplyEmail(base);
    expect(text).toContain("ABC123");
    expect(text).toContain(base.feedbackContent);
    expect(text).toContain(base.replyContent);
    expect(text).toContain("【开发者回复】");
  });

  it("escapes HTML in user-supplied content", () => {
    const { html } = buildFeedbackReplyEmail({
      ...base,
      feedbackContent: '<script>alert("x")</script>',
      replyContent: "回复 <b>加粗</b> & 符号",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
  });

  it("converts newlines in the reply to <br /> in html", () => {
    const { html } = buildFeedbackReplyEmail({
      ...base,
      replyContent: "第一行\n第二行",
    });
    expect(html).toContain("第一行<br />第二行");
  });

  it("shows the resolved badge only when resolved", () => {
    const resolved = buildFeedbackReplyEmail({ ...base, resolved: true });
    const open = buildFeedbackReplyEmail({ ...base, resolved: false });
    expect(resolved.html).toContain("该问题已处理完成");
    expect(resolved.text).toContain("已处理完成");
    expect(open.html).not.toContain("该问题已处理完成");
  });

  it("clips very long feedback quotes", () => {
    const long = "很长的反馈".repeat(200);
    const { text } = buildFeedbackReplyEmail({ ...base, feedbackContent: long });
    expect(text).not.toContain(long);
    expect(text).toContain("…");
  });

  it("omits the date label when feedbackDate is missing or invalid", () => {
    const { text } = buildFeedbackReplyEmail({ ...base, feedbackDate: "not-a-date" });
    expect(text).toContain("您提交的反馈");
  });
});
