import { buildRealBankLaunchEmail, REAL_BANK_LAUNCH_COUNTS } from "../lib/mail/templates/realBankLaunch";
import { REAL_WRITING_COUNTS } from "../components/home/realExamCounts";
import readingCounts from "../data/realBank/reading/counts.json";
import listeningCounts from "../data/realBank/listening/counts.json";
import speakingCounts from "../data/realBank/speaking/counts.json";
import announcements from "../data/announcements.json";

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

describe("buildRealBankLaunchEmail", () => {
  test("counts snapshot matches live banks (公告数字不许过期)", () => {
    const C = REAL_BANK_LAUNCH_COUNTS;
    expect(C.writing.discussion).toBe(REAL_WRITING_COUNTS.discussion);
    expect(C.writing.email).toBe(REAL_WRITING_COUNTS.email);
    expect(C.writing.bs).toBe(REAL_WRITING_COUNTS.bs);
    expect(C.writing.bsSets).toBe(REAL_WRITING_COUNTS.bsSets);
    expect(C.writing.total).toBe(C.writing.discussion + C.writing.email + C.writing.bs);
    expect(C.reading).toEqual({ total: sum(readingCounts), ...readingCounts });
    expect(C.listening).toBe(sum(listeningCounts));
    expect(C.speaking).toBe(sum(speakingCounts));
    expect(C.total).toBe(C.writing.total + C.reading.total + C.listening + C.speaking);
  });

  test("in-app announcement carries the same total", () => {
    // 题量会随补录增长；公告不回头改，所以看「最新一条提到真题题量的公告」是否与快照一致。
    const entry = announcements.find((a) => a.items.some((t) => /共 \d+ 题/.test(t)));
    expect(entry).toBeTruthy();
    expect(entry.items.join("\n")).toContain(`共 ${REAL_BANK_LAUNCH_COUNTS.total} 题`);
  });

  test("pro view: greeting, counts, real-bank link, no upgrade nag", () => {
    const { subject, text, html } = buildRealBankLaunchEmail({ userCode: "ABC123", isPro: true });
    expect(subject).toContain("真题专区");
    expect(text).toContain("ABC123");
    expect(text).toContain("/real-bank");
    expect(text).toContain("您已是 Pro 用户");
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain("去做真题");
    expect(html).not.toContain("升级 Pro，解锁真题专区");
  });

  test("free view: upgrade CTA", () => {
    const { text, html } = buildRealBankLaunchEmail({ userCode: "ABC123", isPro: false });
    expect(text).toContain("Pro 专属");
    expect(html).toContain("升级 Pro，解锁真题专区");
  });

  test("no user code → generic greeting, no placeholder", () => {
    const { text, html } = buildRealBankLaunchEmail({ userCode: "", isPro: true });
    expect(text.startsWith("您好：")).toBe(true);
    expect(html).not.toContain("ABC123");
    expect(html).not.toContain("公开");
  });

  test("html escapes user code", () => {
    const { html } = buildRealBankLaunchEmail({ userCode: "<scr>", isPro: true });
    expect(html).not.toContain("<scr>");
    expect(html).toContain("&lt;scr&gt;");
  });
});
