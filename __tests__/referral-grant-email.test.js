import { buildReferralGrantedEmail } from "../lib/mail/templates/referralGranted";

describe("buildReferralGrantedEmail", () => {
  test("subject mentions days added", () => {
    const { subject } = buildReferralGrantedEmail({
      inviterCode: "ABC123", daysAdded: 3, totalDaysEarned: 3,
    });
    expect(subject).toContain("3 天");
  });

  test("plain text body contains inviter code, days, and a link", () => {
    const { text } = buildReferralGrantedEmail({
      inviterCode: "ABC123", daysAdded: 3, totalDaysEarned: 9,
    });
    expect(text).toContain("ABC123");
    expect(text).toContain("+3 天 Pro");
    expect(text).toContain("9 天 Pro"); // cumulative
    expect(text).toMatch(/https?:\/\//); // CTA link
    expect(text).toContain("/?ref=ABC123");
  });

  test("html body contains structure markers + inviter code + expiry date", () => {
    const { html } = buildReferralGrantedEmail({
      inviterCode: "XYZ789",
      daysAdded: 3,
      totalDaysEarned: 6,
      tierExpiresAt: "2026-06-15T12:00:00Z",
    });
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain("XYZ789");
    expect(html).toContain("+3 天 Pro");
    expect(html).toContain("2026-06-15");
    expect(html).toContain("6 天");
  });

  test("html escapes inviter code (defense in depth — code is normalized upstream)", () => {
    // The state machine + bind API normalize codes to 6-char [A-Z0-9],
    // but defensive HTML escaping here is a no-cost safety net.
    const { html } = buildReferralGrantedEmail({
      inviterCode: "<scr>", daysAdded: 3, totalDaysEarned: 3,
    });
    expect(html).not.toContain("<scr>");
    expect(html).toContain("&lt;scr&gt;");
  });

  test("omits expiry block when tierExpiresAt is missing or invalid", () => {
    const { text, html } = buildReferralGrantedEmail({
      inviterCode: "ABC123", daysAdded: 3, totalDaysEarned: 3,
    });
    expect(text).not.toMatch(/到期日：/);
    expect(html).not.toMatch(/到期日：/);
  });

  test("omits cumulative line when totalDaysEarned is 0/undefined", () => {
    const { text } = buildReferralGrantedEmail({
      inviterCode: "ABC123", daysAdded: 3,
    });
    expect(text).not.toMatch(/累计已获得/);
  });
});
