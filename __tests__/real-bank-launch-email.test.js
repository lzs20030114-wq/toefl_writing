import { buildRealBankLaunchEmail, REAL_BANK_LAUNCH_COUNTS } from "../lib/mail/templates/realBankLaunch";
import announcements from "../data/announcements.json";

/**
 * 2026-09-09 改：这里原本把 REAL_BANK_LAUNCH_COUNTS 逐项和 live 题库
 * （reading/listening/speaking 的 counts.json + REAL_WRITING_COUNTS）比，
 * 意思是「公告数字不许过期」。
 *
 * 真题自动录入（docs/realbank-ingest-contract.md）上线后这条门站不住了：后台拖入一套源文件
 * 就会重建题库、push main，题量**天天在变**。而这封邮件是一封已经发出去的发版公告，
 * 它记的是「发信那一刻」的快照 —— 快照本来就该冻住，跟着库涨反而是错的（老用户收到的
 * 那封信里写的还是 1202）。继续比下去的唯一结果是：每次自动录入都把 CI 打红，
 * 然后有人为了让 CI 绿而去改一封已经发出去的信里的数字。
 *
 * 所以门收窄成「模板自洽 + 与应用内公告一致」：
 *   · 快照内部加得起来（分项 → 小计 → 总数）；
 *   · 邮件正文里出现的数字确实来自快照（不是手写死在文案里的另一个数）；
 *   · data/announcements.json 里最新一条提到题量的公告与快照对得上（同一次发版的两个出口）。
 * 「首页显示的题量不许过期」那道门另有归属：__tests__/real-bank-section.component.test.js
 * 拿 REAL_WRITING_COUNTS 和 lib/realBank 现算值交叉校验，自动录入会跑
 * scripts/realbank/sync_counts.mjs 把它同步上，所以那一条继续有效。
 */
describe("buildRealBankLaunchEmail", () => {
  test("counts snapshot is internally consistent (分项加得起来)", () => {
    const C = REAL_BANK_LAUNCH_COUNTS;
    expect(C.writing.total).toBe(C.writing.discussion + C.writing.email + C.writing.bs);
    expect(C.reading.total).toBe(C.reading.ap + C.reading.rdl + C.reading.ctw);
    expect(C.total).toBe(C.writing.total + C.reading.total + C.listening + C.speaking);
    // bsSets 是「几卷」，不参与求和，但必须比题数少（一卷至少 5 题，见 REAL_BS_MIN_BATCH）
    expect(C.writing.bsSets).toBeGreaterThan(0);
    expect(C.writing.bsSets * 5).toBeLessThanOrEqual(C.writing.bs);
  });

  test("邮件正文用的是快照里的数字，不是另写死一份", () => {
    const { subject, text } = buildRealBankLaunchEmail({ userCode: "ABC123", isPro: true });
    const C = REAL_BANK_LAUNCH_COUNTS;
    expect(subject).toContain(String(C.total));
    expect(text).toContain(`共 ${C.total} 题`);
    expect(text).toContain(String(C.writing.total));
    expect(text).toContain(String(C.reading.total));
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
