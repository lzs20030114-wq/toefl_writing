/**
 * Component tests for the 「语音授权管理」revoke entry + dialog.
 *
 * Doubles as build-level verification: importing + rendering these client
 * components forces the JSX (and their imports) to transpile and mount under
 * jsdom. Covers visibility gating, the two-step confirm flow, the success path
 * (marker cleared, link hidden) and the PURGE_FAILED error path (loud, marker
 * kept).
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import { SpeechAuthEntry } from "../components/speaking/SpeechConsentManager";
import { markSpeechConsent, hasLocalSpeechConsent } from "../components/speaking/speechConsentState";

const CODE = "ABC123";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("toefl-user-code", CODE);
});

afterEach(() => {
  delete global.fetch;
});

test("entry hidden when there is no local consent marker", () => {
  render(<SpeechAuthEntry />);
  expect(screen.queryByText("语音授权管理")).toBeNull();
});

test("entry shows for a consented user and opens the manager dialog", () => {
  markSpeechConsent(CODE);
  render(<SpeechAuthEntry />);

  const link = screen.getByText("语音授权管理");
  fireEvent.click(link);

  // Status view discloses the current consent version.
  expect(screen.getByText(/已同意语音识别授权（v2）/)).toBeTruthy();
  expect(screen.getByText("撤回授权")).toBeTruthy();
});

test("revoke is a two-step confirmation with an explicit warning", () => {
  markSpeechConsent(CODE);
  render(<SpeechAuthEntry />);

  fireEvent.click(screen.getByText("语音授权管理"));
  fireEvent.click(screen.getByText("撤回授权"));

  expect(screen.getByText("确认撤回语音授权？")).toBeTruthy();
  expect(screen.getByText(/口语 AI 评分将不可用/)).toBeTruthy();
  expect(screen.getByText("确认撤回")).toBeTruthy();
});

test("successful revoke clears the marker, shows success, and hides the link", async () => {
  markSpeechConsent(CODE);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, consented: false, deleted: 2 }),
  });

  render(<SpeechAuthEntry />);
  fireEvent.click(screen.getByText("语音授权管理"));
  fireEvent.click(screen.getByText("撤回授权"));

  await act(async () => {
    fireEvent.click(screen.getByText("确认撤回"));
  });

  expect(global.fetch).toHaveBeenCalledWith("/api/speech/consent", expect.objectContaining({ method: "POST" }));
  expect(screen.getByText("已撤回语音授权")).toBeTruthy();
  expect(hasLocalSpeechConsent(CODE)).toBe(false);
  // Marker cleared → the bottom link is gone.
  expect(screen.queryByText("语音授权管理")).toBeNull();
});

test("PURGE_FAILED surfaces the server message loudly and keeps the marker", async () => {
  markSpeechConsent(CODE);
  const serverMsg = "已撤回同意，但删除已留存录音时出错：storage down";
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({ ok: false, code: "PURGE_FAILED", error: serverMsg }),
  });

  render(<SpeechAuthEntry />);
  fireEvent.click(screen.getByText("语音授权管理"));
  fireEvent.click(screen.getByText("撤回授权"));

  await act(async () => {
    fireEvent.click(screen.getByText("确认撤回"));
  });

  expect(screen.getByText(serverMsg)).toBeTruthy();
  // Not falsely cleared — the recordings were not confirmed deleted.
  expect(hasLocalSpeechConsent(CODE)).toBe(true);
  expect(screen.queryByText("已撤回语音授权")).toBeNull();
});
