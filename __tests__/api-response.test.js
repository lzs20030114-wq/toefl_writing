const { jsonError } = require("../lib/apiResponse");

// Response.json() is a Web API not available in jsdom; polyfill for tests
if (typeof Response === "undefined" || !Response.json) {
  globalThis.Response = class Response {
    constructor(body, init = {}) {
      this._body = body;
      this.status = init.status || 200;
    }
    async json() { return JSON.parse(this._body); }
    static json(data, init = {}) {
      return new Response(JSON.stringify(data), init);
    }
  };
}

describe("jsonError", () => {
  it("returns Response with correct status and body", async () => {
    const res = jsonError(400, "Missing field");
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Missing field" });
  });

  it("returns 429 for rate limit errors", async () => {
    const res = jsonError(429, "Too many requests");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "Too many requests" });
  });

  it("returns 500 for server errors", async () => {
    const res = jsonError(500, "Unexpected error");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Unexpected error" });
  });
});
