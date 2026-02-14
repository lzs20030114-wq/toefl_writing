/**
 * @jest-environment node
 */

import { POST } from "../app/api/ai/route";

describe("/api/ai route", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns parsed content when upstream succeeds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{\"score\":4}" } }] }),
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe("{\"score\":4}");
  });

  test("passes through upstream error status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m" }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("DeepSeek API error: 401");
  });
});

