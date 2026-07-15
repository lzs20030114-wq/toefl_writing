/**
 * Unit tests for the local speech-consent marker that drives whether the
 * 「语音授权管理」(revoke) entry is surfaced on the Speaking page.
 *
 * Runs under the default jsdom env (window + localStorage available).
 */

import {
  markSpeechConsent,
  clearSpeechConsent,
  hasLocalSpeechConsent,
  SPEECH_CONSENT_EVENT,
} from "../components/speaking/speechConsentState";

describe("speechConsentState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("no marker → hasLocalSpeechConsent is false", () => {
    expect(hasLocalSpeechConsent("ABC123")).toBe(false);
  });

  test("mark → has for that code, case-insensitive", () => {
    markSpeechConsent("abc123");
    expect(hasLocalSpeechConsent("ABC123")).toBe(true);
    expect(hasLocalSpeechConsent("abc123")).toBe(true);
  });

  test("marker is code-scoped — a different code does not match", () => {
    markSpeechConsent("ABC123");
    expect(hasLocalSpeechConsent("XYZ999")).toBe(false);
  });

  test("clear removes the marker", () => {
    markSpeechConsent("ABC123");
    clearSpeechConsent();
    expect(hasLocalSpeechConsent("ABC123")).toBe(false);
  });

  test("empty / falsy codes are never marked or matched", () => {
    markSpeechConsent("");
    expect(hasLocalSpeechConsent("")).toBe(false);
    markSpeechConsent(null);
    expect(hasLocalSpeechConsent(null)).toBe(false);
  });

  test("mark and clear each emit a same-tab change event", () => {
    const seen = [];
    const handler = () => seen.push(1);
    window.addEventListener(SPEECH_CONSENT_EVENT, handler);
    markSpeechConsent("ABC123");
    clearSpeechConsent();
    window.removeEventListener(SPEECH_CONSENT_EVENT, handler);
    expect(seen.length).toBe(2);
  });
});
