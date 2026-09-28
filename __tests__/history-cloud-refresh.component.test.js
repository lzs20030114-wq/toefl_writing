// Actual history views and session/cloud stores; mock only the database transport.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RealBankProgressView } from "../components/realBank/RealBankProgressView";
import { ProgressView } from "../components/ProgressView";
import { clearAllSessions, deleteSession, loadHist, saveSess, setCurrentUser, updateSessionDetails } from "../lib/sessionStore";
import { buildRealBankEntries } from "../lib/realBankHistory";

const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockDelete = jest.fn();
const mockUpdate = jest.fn();
jest.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      insert: (...args) => mockInsert(...args),
      select: () => ({ eq: (_key, code) => ({ order: () => ({ limit: () => mockSelect(code) }) }) }),
      delete: () => ({ eq: (...args) => mockDelete(...args) }),
      update: (value) => ({ eq: () => ({ eq: () => mockUpdate(value) }) }),
    }),
  },
}));

const email = {
  id: 41, type: "email", date: "2026-09-28T10:00:00Z", score: { score: 4, mode: "practice" },
  details: { promptId: "real_tpo1", userText: "Previously saved email" },
};
const discussion = {
  type: "discussion", date: "2026-09-28T11:00:00Z", score: 4, mode: "practice",
  details: { promptId: "real_disc_probe", userText: "Submitted discussion", practiceRootId: "discussion-1", practiceAttempt: 1 },
};
const bs = {
  type: "bs", date: "2026-09-28T11:10:00Z", correct: 1, total: 1, mode: "practice",
  details: [{ qid: "real_bs_probe", userAnswer: "I agree.", correctAnswer: "I agree.", isCorrect: true }],
};
const discussionRow = { ...discussion, id: 42, score: { score: 4, mode: "practice" } };
const bsRow = { ...bs, id: 43, score: { correct: 1, total: 1, mode: "practice" } };
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }
function visibleTypes() { return buildRealBankEntries(loadHist().sessions).map((e) => e.subtype).sort(); }

let rows, originalFetch;
beforeEach(() => {
  setCurrentUser(null);
  localStorage.clear();
  localStorage.setItem("toefl-user-code", "PROBE1");
  rows = [email];
  mockSelect.mockReset().mockImplementation(async () => ({ data: [...rows], error: null }));
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockDelete.mockReset().mockResolvedValue({ error: null });
  mockUpdate.mockReset().mockResolvedValue({ error: null });
  originalFetch = global.fetch;
  global.fetch = jest.fn(() => new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  setCurrentUser(null);
  localStorage.clear();
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each([["real", RealBankProgressView], ["writing", ProgressView]])("reentering %s history fetches records successfully saved in another tab", async (_name, View) => {
  let view = render(<View />);
  await waitFor(() => expect(visibleTypes()).toEqual(["email"]));
  view.unmount();
  rows.push(discussionRow, bsRow);
  view = render(<View />);
  await waitFor(() => expect(visibleTypes()).toEqual(["bs", "discussion", "email"]));
  expect(mockSelect).toHaveBeenCalledTimes(2);
  if (_name === "real") expect(screen.getAllByTestId("real-entry-row")).toHaveLength(3);
  else {
    expect(screen.getByText("3 条记录")).toBeInTheDocument();
  }
  view.unmount();
});

test.each(["focus", "visibilitychange", "both"])("return via %s refreshes the real history without duplicate requests", async (event) => {
  render(<RealBankProgressView />);
  expect(await screen.findAllByTestId("real-entry-row")).toHaveLength(1);
  rows.push(discussionRow, bsRow);
  jest.useFakeTimers();
  await act(async () => {
    if (event !== "visibilitychange") window.dispatchEvent(new Event("focus"));
    if (event !== "focus") document.dispatchEvent(new Event("visibilitychange"));
    jest.advanceTimersByTime(100);
    await flush();
  });
  expect(screen.getAllByTestId("real-entry-row")).toHaveLength(3);
  expect(mockSelect).toHaveBeenCalledTimes(2);
});

test("writing history keeps its loading state until the first cloud read completes", async () => {
  const read = deferred();
  mockSelect.mockReturnValueOnce(read.promise);
  render(<ProgressView />);
  expect(screen.getByText("加载中…")).toBeInTheDocument();
  expect(screen.queryByText("还没有练习记录")).not.toBeInTheDocument();
  await act(async () => {
    read.resolve({ data: [email], error: null });
    await flush();
  });
  expect(screen.getByText("1 条记录")).toBeInTheDocument();
});

test("hidden tab and cleaned-up subscriptions do not trigger cloud queries", async () => {
  const view = render(<RealBankProgressView />);
  await screen.findAllByTestId("real-entry-row");
  jest.useFakeTimers();
  const visibility = jest.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  act(() => jest.advanceTimersByTime(200));
  expect(mockSelect).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  fireEvent(window, new Event("focus"));
  view.unmount();
  act(() => jest.advanceTimersByTime(200));
  expect(mockSelect).toHaveBeenCalledTimes(1);
});

test("same-account concurrent refreshes share a single in-flight read", async () => {
  const read = deferred();
  mockSelect.mockReturnValueOnce(read.promise);
  const first = setCurrentUser("PROBE1", { refresh: true });
  const second = setCurrentUser("PROBE1", { refresh: true });
  expect(second).toBe(first);
  expect(mockSelect).toHaveBeenCalledTimes(1);
  read.resolve({ data: [email], error: null });
  await first;
  expect(visibleTypes()).toEqual(["email"]);
});

test("late pre-insert read and foreground refresh cannot erase pending submissions", async () => {
  await setCurrentUser("PROBE1");
  const oldRead = deferred(), firstInsert = deferred(), secondInsert = deferred();
  mockSelect.mockReturnValueOnce(oldRead.promise);
  const refreshing = setCurrentUser("PROBE1", { refresh: true });
  mockInsert.mockReturnValueOnce(firstInsert.promise).mockReturnValueOnce(secondInsert.promise);
  saveSess(discussion);
  saveSess(bs);
  const duringWrites = setCurrentUser("PROBE1", { refresh: true });
  oldRead.resolve({ data: [email], error: null });
  await refreshing;
  expect(visibleTypes()).toEqual(["bs", "discussion", "email"]);
  expect(mockSelect).toHaveBeenCalledTimes(2);
  rows.push(discussionRow);
  firstInsert.resolve({ error: null });
  await flush();
  expect(mockSelect).toHaveBeenCalledTimes(2);
  expect(visibleTypes()).toEqual(["bs", "discussion", "email"]);
  rows.push(bsRow);
  secondInsert.resolve({ error: null });
  await duringWrites;
  await flush();
  expect(mockSelect).toHaveBeenCalledTimes(3);
  expect(visibleTypes()).toEqual(["bs", "discussion", "email"]);
  expect(loadHist().sessions).toHaveLength(3);
});

test("switching accounts immediately isolates caches and ignores old reads even after returning", async () => {
  await setCurrentUser("PROBE1");
  const oldA = deferred(), readB = deferred(), newA = deferred();
  mockSelect.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(readB.promise).mockReturnValueOnce(newA.promise);
  const first = setCurrentUser("PROBE1", { refresh: true });
  const second = setCurrentUser("PROBE2");
  expect(loadHist().sessions).toEqual([]);
  const third = setCurrentUser("PROBE1");
  expect(loadHist().sessions).toEqual([]);
  oldA.resolve({ data: [email], error: null });
  readB.resolve({ data: [bsRow], error: null });
  await Promise.all([first, second]);
  expect(loadHist().sessions).toEqual([]);
  newA.resolve({ data: [email, discussionRow], error: null });
  await third;
  expect(visibleTypes()).toEqual(["discussion", "email"]);
});

test("an old account's pending insert completion does not refresh or overwrite the new account", async () => {
  await setCurrentUser("PROBE1");
  const insert = deferred();
  mockInsert.mockReturnValueOnce(insert.promise);
  saveSess(bs);
  mockSelect.mockResolvedValueOnce({ data: [], error: null });
  await setCurrentUser("PROBE2");
  insert.resolve({ error: null });
  await flush();
  expect(mockSelect).toHaveBeenCalledTimes(2);
  expect(loadHist().sessions).toEqual([]);
});

test.each(["returned error", "rejection"])("%s releases the pending-write guard so a later refresh works", async (failure) => {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  await setCurrentUser("PROBE1");
  if (failure === "rejection") mockInsert.mockRejectedValueOnce(new Error("connection interrupted"));
  else mockInsert.mockResolvedValueOnce({ error: { message: "connection interrupted" } });
  saveSess(bs);
  await flush();
  rows.push(discussionRow);
  await setCurrentUser("PROBE1", { refresh: true });
  expect(visibleTypes()).toEqual(["discussion", "email"]);
  expect(errorSpy).toHaveBeenCalled();
});

test.each(["delete", "clear"])("%s cannot be undone by a pre-mutation read", async (operation) => {
  await setCurrentUser("PROBE1");
  const oldRead = deferred(), mutation = deferred();
  mockSelect.mockReturnValueOnce(oldRead.promise);
  const refreshing = setCurrentUser("PROBE1", { refresh: true });
  mockDelete.mockReturnValueOnce(mutation.promise);
  if (operation === "delete") deleteSession(email.id); else clearAllSessions();
  const duringMutation = setCurrentUser("PROBE1", { refresh: true });
  oldRead.resolve({ data: [email], error: null });
  await refreshing;
  expect(loadHist().sessions).toEqual([]);
  rows = [];
  mutation.resolve({ error: null });
  await duringMutation;
  expect(mockSelect).toHaveBeenCalledTimes(3);
  expect(loadHist().sessions).toEqual([]);
});

test("a stale read cannot overwrite a lesson details update", async () => {
  rows.push(discussionRow);
  await setCurrentUser("PROBE1");
  const oldRead = deferred(), mutation = deferred();
  mockSelect.mockReturnValueOnce(oldRead.promise);
  const refreshing = setCurrentUser("PROBE1", { refresh: true });
  mockUpdate.mockReturnValueOnce(mutation.promise);
  const updating = updateSessionDetails({ practiceRootId: "discussion-1", practiceAttempt: 1 }, (d) => ({ ...d, lesson: "New lesson" }));
  oldRead.resolve({ data: [...rows], error: null });
  await refreshing;
  expect(loadHist().sessions.find((s) => s.type === "discussion").details.lesson).toBe("New lesson");
  rows = [email, { ...discussionRow, details: { ...discussionRow.details, lesson: "New lesson" } }];
  mutation.resolve({ error: null });
  expect(await updating).toBe(true);
  await flush();
  expect(loadHist().sessions.find((s) => s.type === "discussion").details.lesson).toBe("New lesson");
});

test("lesson write-back arriving during an insert waits for the cloud row id", async () => {
  await setCurrentUser("PROBE1");
  const insert = deferred();
  mockInsert.mockReturnValueOnce(insert.promise);
  mockUpdate.mockImplementation(async ({ details }) => {
    rows = [email, { ...discussionRow, details }];
    return { error: null };
  });
  saveSess(discussion);
  const updating = updateSessionDetails({ practiceRootId: "discussion-1", practiceAttempt: 1 }, (d) => ({ ...d, lesson: "Ready early" }));
  expect(mockUpdate).not.toHaveBeenCalled();
  rows.push(discussionRow);
  insert.resolve({ error: null });
  expect(await updating).toBe(true);
  await flush();
  expect(loadHist().sessions.find((s) => s.type === "discussion").details.lesson).toBe("Ready early");
});
