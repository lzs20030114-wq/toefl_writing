/**
 * @jest-environment node
 *
 * Route tests for /api/speech/consent — the compliance-critical paths:
 *   - grant writes consent v2, degrading gracefully if the version column is absent
 *   - revoke stamps the revoke time AND cascade-deletes the user's retained audio
 *   - revoke tolerates a pre-migration (missing) speech_recordings table
 *   - a purge failure is surfaced loudly (never a false "deleted" claim)
 *
 * Supabase is mocked following the __tests__/api-ai-route.test.js convention.
 */

let grantUpdateResults = [];   // successive {error} for users.update().eq()
let recordingsRows = { data: [], error: null };
let removeResult = { error: null };
let deleteResult = { error: null };
let capturedUpdates = [];      // payloads passed to .from("users").update()
let capturedRemove = [];       // { bucket, paths } passed to storage.remove()
let capturedDeletes = [];      // tables passed to .from(t).delete()

jest.mock("../lib/supabaseAdmin", () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    from(table) {
      return {
        update(payload) {
          capturedUpdates.push({ table, payload });
          return { eq: async () => (grantUpdateResults.length ? grantUpdateResults.shift() : { error: null }) };
        },
        select() {
          return { eq: async () => recordingsRows };
        },
        delete() {
          capturedDeletes.push(table);
          return { eq: async () => deleteResult };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) { capturedRemove.push({ bucket, paths }); return removeResult; },
        };
      },
    },
  },
}));

import { POST } from "../app/api/speech/consent/route";

function req(body) {
  return new Request("http://localhost/api/speech/consent", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  grantUpdateResults = [];
  recordingsRows = { data: [], error: null };
  removeResult = { error: null };
  deleteResult = { error: null };
  capturedUpdates = [];
  capturedRemove = [];
  capturedDeletes = [];
});

describe("grant", () => {
  test("records consent version 2", async () => {
    const res = await POST(req({ user_code: "ABCDEF", action: "grant" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.consent_version).toBe(2);
    expect(capturedUpdates[0].payload.speech_consent_version).toBe(2);
    expect(capturedUpdates[0].payload.speech_consent_revoked_at).toBeNull();
  });

  test("degrades to a version-less write when the column is absent", async () => {
    grantUpdateResults = [
      { error: { code: "42703", message: 'column users.speech_consent_version does not exist' } },
      { error: null },
    ];
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(req({ user_code: "ABCDEF", action: "grant" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // First attempt included the version; the retry omitted it.
    expect(capturedUpdates[0].payload).toHaveProperty("speech_consent_version");
    expect(capturedUpdates[1].payload).not.toHaveProperty("speech_consent_version");
    expect(capturedUpdates[1].payload.speech_consent_at).toBeTruthy();
    warn.mockRestore();
  });
});

describe("revoke", () => {
  test("cascade-deletes the user's retained recordings from the whitelisted bucket", async () => {
    recordingsRows = {
      data: [
        { id: "1", storage_path: "ABCDEF/2026-07-16/a.webm" },
        { id: "2", storage_path: "ABCDEF/2026-07-16/b.webm" },
      ],
      error: null,
    };
    const res = await POST(req({ user_code: "ABCDEF", action: "revoke" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.consented).toBe(false);
    expect(body.deleted).toBe(2);
    // Revoke time was stamped.
    expect(capturedUpdates[0].payload.speech_consent_revoked_at).toBeTruthy();
    // Objects removed from the private speech bucket only.
    expect(capturedRemove[0].bucket).toBe("speech_recordings");
    expect(capturedRemove[0].paths).toEqual([
      "ABCDEF/2026-07-16/a.webm",
      "ABCDEF/2026-07-16/b.webm",
    ]);
    expect(capturedDeletes).toContain("speech_recordings");
  });

  test("tolerates a pre-migration missing recordings table (nothing to purge)", async () => {
    recordingsRows = { data: null, error: { code: "42P01", message: 'relation "speech_recordings" does not exist' } };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(req({ user_code: "ABCDEF", action: "revoke" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(0);
    expect(capturedRemove).toHaveLength(0); // never touched storage
    warn.mockRestore();
  });

  test("surfaces a purge failure loudly (no false deletion claim)", async () => {
    recordingsRows = { data: [{ id: "1", storage_path: "ABCDEF/2026-07-16/a.webm" }], error: null };
    removeResult = { error: { message: "storage boom" } };
    const res = await POST(req({ user_code: "ABCDEF", action: "revoke" }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("PURGE_FAILED");
  });
});

describe("validation", () => {
  test("rejects a bad user code", async () => {
    const res = await POST(req({ user_code: "X", action: "grant" }));
    expect(res.status).toBe(403);
  });

  test("rejects an unknown action", async () => {
    const res = await POST(req({ user_code: "ABCDEF", action: "delete-everything" }));
    expect(res.status).toBe(400);
  });
});
