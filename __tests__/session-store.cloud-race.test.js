import { loadHist, setCurrentUser } from "../lib/sessionStore";
import { loadSessionsCloud } from "../lib/cloudSessionStore";

jest.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
}));

jest.mock("../lib/cloudSessionStore", () => ({
  loadSessionsCloud: jest.fn(),
  saveSessionCloud: jest.fn(async () => ({ error: null })),
  deleteSessionCloud: jest.fn(async () => ({ error: null })),
  clearAllSessionsCloud: jest.fn(async () => ({ error: null })),
}));

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("sessionStore cloud sync race", () => {
  afterEach(() => {
    setCurrentUser(null);
    jest.clearAllMocks();
  });

  test("ignores stale sync result from previous user code", async () => {
    const d1 = defer();
    const d2 = defer();
    loadSessionsCloud.mockImplementationOnce(() => d1.promise);
    loadSessionsCloud.mockImplementationOnce(() => d2.promise);

    setCurrentUser("AAAAAA");
    setCurrentUser("BBBBBB");

    d2.resolve({ sessions: [{ id: 2, type: "email", score: 4 }], error: null });
    await Promise.resolve();
    await Promise.resolve();
    expect((loadHist().sessions || []).map((x) => x.id)).toEqual([2]);

    d1.resolve({ sessions: [{ id: 1, type: "email", score: 2 }], error: null });
    await Promise.resolve();
    await Promise.resolve();
    expect((loadHist().sessions || []).map((x) => x.id)).toEqual([2]);
  });
});

