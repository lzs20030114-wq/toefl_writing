/**
 * @jest-environment node
 *
 * 真题录入后台 API：鉴权、建 job 的入参校验、start 的「文件必须传齐」闸、
 * 复核决定写出的 JSON 形状。Supabase / GitHub 全部 mock，不打真网络。
 */
const jobsStore = { created: [], updated: [], byId: {}, list: [] };
const storageStore = { signed: [], present: [], deleted: [] };
const dispatched = [];
const repoFiles = {};
const puts = [];

jest.mock("../lib/realBankIngest/jobs", () => ({
  TABLE: "real_bank_ingest_jobs",
  createJob: jest.fn(async (row) => {
    const job = { id: "11111111-2222-3333-4444-555555555555", status: row.kind === "rebuild" ? "queued" : "uploading", ...row };
    jobsStore.created.push(row);
    jobsStore.byId[job.id] = job;
    return job;
  }),
  getJob: jest.fn(async (id) => jobsStore.byId[id] || null),
  listJobs: jest.fn(async () => jobsStore.list),
  updateJob: jest.fn(async (id, patch) => {
    jobsStore.updated.push({ id, patch });
    jobsStore.byId[id] = { ...(jobsStore.byId[id] || { id }), ...patch };
    return jobsStore.byId[id];
  }),
  appendProgress: jest.fn(async (job) => job),
}));

jest.mock("../lib/realBankIngest/storage", () => ({
  createSignedUploads: jest.fn(async (jobId, files) => {
    storageStore.signed.push({ jobId, files });
    return files.map((f) => ({ path: f.path, objectPath: `jobs/${jobId}/${f.path}`, signedUrl: "https://x", token: "t" }));
  }),
  listJobFiles: jest.fn(async () => storageStore.present),
  deleteJobDir: jest.fn(async () => ({ removed: (storageStore.deleted.push(1), 3) })),
}));

jest.mock("../lib/realBankIngest/dispatch", () => ({
  ghConfig: () => ({ owner: "o", repo: "r", workflow: "real-bank-ingest.yml" }),
  dispatchIngestWorkflow: jest.fn(async () => ({ ok: true })),
  queueAndDispatch: jest.fn(async (id, patch) => {
    dispatched.push({ id, patch });
    return { ok: true, job: { id, status: "dispatched", ...patch } };
  }),
  startRebuild: jest.fn(async (reason) => {
    dispatched.push({ rebuild: reason });
    return { ok: true, job: { id: "rebuild-job", status: "dispatched" } };
  }),
}));

jest.mock("../lib/githubApi", () => ({
  getRepoFile: jest.fn(async (p) => repoFiles[p] || null),
  putRepoFile: jest.fn(async (p, content, sha, message) => {
    puts.push({ path: p, content, sha, message });
    repoFiles[p] = { content, sha: "newsha" };
    return {};
  }),
  deleteRepoFile: jest.fn(),
}));

const jobsRoute = require("../app/api/admin/real-bank-ingest/jobs/route");
const startRoute = require("../app/api/admin/real-bank-ingest/jobs/[id]/start/route");
const cancelRoute = require("../app/api/admin/real-bank-ingest/jobs/[id]/cancel/route");
const formatRoute = require("../app/api/admin/real-bank-ingest/jobs/[id]/format/route");
const reviewRoute = require("../app/api/admin/real-bank-ingest/review/route");
const decisionRoute = require("../app/api/admin/real-bank-ingest/review/decision/route");

const JOB = "11111111-2222-3333-4444-555555555555";

function req(url, { body, token = "secret" } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("x-admin-token", token);
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_TOKEN = "secret";
  jobsStore.created = [];
  jobsStore.updated = [];
  jobsStore.byId = {};
  jobsStore.list = [];
  storageStore.signed = [];
  storageStore.present = [];
  storageStore.deleted = [];
  dispatched.length = 0;
  puts.length = 0;
  for (const k of Object.keys(repoFiles)) delete repoFiles[k];
});

describe("鉴权", () => {
  const cases = [
    ["POST /jobs", () => jobsRoute.POST(req("/api/admin/real-bank-ingest/jobs", { body: {}, token: "" }))],
    ["GET /jobs", () => jobsRoute.GET(req("/api/admin/real-bank-ingest/jobs", { token: "" }))],
    ["start", () => startRoute.POST(req("/x", { body: {}, token: "" }), { params: { id: JOB } })],
    ["cancel", () => cancelRoute.POST(req("/x", { body: {}, token: "" }), { params: { id: JOB } })],
    ["format", () => formatRoute.POST(req("/x", { body: {}, token: "" }), { params: { id: JOB } })],
    ["GET review", () => reviewRoute.GET(req("/x", { token: "" }))],
    ["decision", () => decisionRoute.POST(req("/x", { body: {}, token: "" }))],
  ];
  test.each(cases)("%s 无口令 → 401", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
  });
});

describe("POST /jobs", () => {
  test("非法套名 → 400，且不建 job", async () => {
    const res = await jobsRoute.POST(req("/api/admin/real-bank-ingest/jobs", { body: { set_name: "a/b", files: [{ path: "x.pdf", size: 1 }] } }));
    expect(res.status).toBe(400);
    expect(jobsStore.created).toHaveLength(0);
  });

  test("路径含 .. → 400", async () => {
    const res = await jobsRoute.POST(req("/api/admin/real-bank-ingest/jobs", { body: { set_name: "套A", files: [{ path: "../evil.pdf", size: 1 }] } }));
    expect(res.status).toBe(400);
    expect(jobsStore.created).toHaveLength(0);
  });

  test("单文件超 50MB → 400", async () => {
    const res = await jobsRoute.POST(req("/api/admin/real-bank-ingest/jobs", { body: { set_name: "套A", files: [{ path: "big.mp4", size: 60 * 1024 * 1024 }] } }));
    expect(res.status).toBe(400);
  });

  test("合法入参 → 建 job + 每个文件一条 signed upload", async () => {
    const res = await jobsRoute.POST(req("/api/admin/real-bank-ingest/jobs", {
      body: { set_name: "9.12新托福真题", source_kind: "first_pdf", files: [{ path: "a.pdf", size: 10 }, { path: "audio/q1.mp3", size: 20 }] },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.uploads).toHaveLength(2);
    expect(body.uploads[1].objectPath).toBe(`jobs/${JOB}/audio/q1.mp3`);
    expect(jobsStore.created[0]).toMatchObject({ set_name: "9.12新托福真题", source_kind: "first_pdf", kind: "ingest" });
  });

  test("rebuild 走不了这个端点", async () => {
    const res = await jobsRoute.POST(req("/api/admin/real-bank-ingest/jobs", { body: { set_name: "x", kind: "rebuild" } }));
    expect(res.status).toBe(400);
  });
});

describe("start", () => {
  test("文件没传齐 → 409，且不派工", async () => {
    jobsStore.byId[JOB] = { id: JOB, status: "uploading", files: [{ path: "a.pdf" }, { path: "b.mp3" }] };
    storageStore.present = [{ path: "a.pdf", size: 1 }];
    const res = await startRoute.POST(req("/x", { body: {} }), { params: { id: JOB } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("b.mp3");
    expect(dispatched).toHaveLength(0);
  });

  test("齐了 → 标 uploaded 并派工", async () => {
    jobsStore.byId[JOB] = { id: JOB, status: "uploading", files: [{ path: "a.pdf" }] };
    storageStore.present = [{ path: "a.pdf", size: 1 }];
    const res = await startRoute.POST(req("/x", { body: {} }), { params: { id: JOB } });
    expect(res.status).toBe(200);
    expect(dispatched[0].patch.files).toEqual([{ path: "a.pdf", uploaded: true }]);
  });

  test("任务不存在 → 404；状态不对 → 409", async () => {
    expect((await startRoute.POST(req("/x", { body: {} }), { params: { id: JOB } })).status).toBe(404);
    jobsStore.byId[JOB] = { id: JOB, status: "running", files: [{ path: "a.pdf" }] };
    expect((await startRoute.POST(req("/x", { body: {} }), { params: { id: JOB } })).status).toBe(409);
  });
});

describe("format / cancel", () => {
  test("format 只在 needs_format 生效，且拒 auto", async () => {
    jobsStore.byId[JOB] = { id: JOB, status: "needs_format" };
    expect((await formatRoute.POST(req("/x", { body: { source_kind: "auto" } }), { params: { id: JOB } })).status).toBe(400);
    const ok = await formatRoute.POST(req("/x", { body: { source_kind: "vendor_docx" } }), { params: { id: JOB } });
    expect(ok.status).toBe(200);
    expect(dispatched[0].patch).toEqual({ source_kind: "vendor_docx" });

    jobsStore.byId[JOB] = { id: JOB, status: "running" };
    expect((await formatRoute.POST(req("/x", { body: { source_kind: "vendor_docx" } }), { params: { id: JOB } })).status).toBe(409);
  });

  test("cancel 删源目录并置 cancelled；运行中不许取消", async () => {
    jobsStore.byId[JOB] = { id: JOB, status: "queued", kind: "ingest" };
    const res = await cancelRoute.POST(req("/x", { body: {} }), { params: { id: JOB } });
    expect(res.status).toBe(200);
    expect(storageStore.deleted).toHaveLength(1);
    expect(jobsStore.updated.at(-1).patch).toMatchObject({ status: "cancelled" });

    jobsStore.byId[JOB] = { id: JOB, status: "running" };
    expect((await cancelRoute.POST(req("/x", { body: {} }), { params: { id: JOB } })).status).toBe(409);
  });
});

describe("review 汇总", () => {
  test("done job 的 holds 去重，被 allow 命中的标 resolved", async () => {
    repoFiles["data/realBank/review-overrides.json"] = {
      content: { allow: [{ set: "套A", section: "listening", code: "*" }] },
      sha: "s1",
    };
    repoFiles["data/realBank/review-holds.json"] = { content: { holds: [{ file: "reading/ap", id: "x", scope: "unit", reason: "r" }] }, sha: "s2" };
    jobsStore.list = [
      { id: "j1", status: "done", set_key: "套A", created_at: "2026-09-09", result: { holds: [
        { set: "套A", section: "listening", code: "audit_low_agreement", agreement: 0.58, questions: 24 },
        { set: "套A", section: "reading", code: "section_gap" },
      ] } },
      { id: "j2", status: "done", set_key: "套A", created_at: "2026-09-08", result: { holds: [{ set: "套A", section: "reading", code: "section_gap" }] } },
      { id: "j3", status: "running", set_key: "套B", result: { holds: [{ set: "套B", section: "reading", code: "x" }] } },
    ];
    const res = await reviewRoute.GET(req("/api/admin/real-bank-ingest/review"));
    const body = await res.json();
    expect(body.holds).toHaveLength(2); // 套A 的两条，j2 的重复被去掉，running 的不算
    expect(body.holds.find((h) => h.section === "listening").resolved).toBe(true);
    expect(body.pending).toBe(1);
    expect(body.repoHolds).toHaveLength(1);
  });
});

describe("review/decision", () => {
  test("allow_section 追加进 overrides.allow[] 并派 rebuild", async () => {
    repoFiles["data/realBank/review-overrides.json"] = { content: { allow: [] }, sha: "s1" };
    const res = await decisionRoute.POST(req("/x", {
      body: { action: "allow_section", set_key: "9.12新托福真题", section: "listening", code: "audit_low_agreement", reason: "人工核过" },
    }));
    expect(res.status).toBe(200);
    const put = puts[0];
    expect(put.path).toBe("data/realBank/review-overrides.json");
    expect(put.sha).toBe("s1");
    expect(put.content.allow).toHaveLength(1);
    expect(put.content.allow[0]).toMatchObject({
      set: "9.12新托福真题", section: "listening", code: "audit_low_agreement", reason: "人工核过", by: "admin",
    });
    expect(typeof put.content.allow[0].at).toBe("string");
    expect(dispatched.at(-1).rebuild).toContain("放行");
    expect((await res.json()).job.id).toBe("rebuild-job");
  });

  test("allow_section 幂等：同一 (set,section,code) 不重复追加", async () => {
    repoFiles["data/realBank/review-overrides.json"] = { content: { allow: [] }, sha: "s1" };
    const body = { action: "allow_section", set_key: "套A", section: "reading", code: "*", reason: "r1" };
    await decisionRoute.POST(req("/x", { body }));
    await decisionRoute.POST(req("/x", { body: { ...body, reason: "r2" } }));
    expect(puts.at(-1).content.allow).toHaveLength(1);
    expect(puts.at(-1).content.allow[0].reason).toBe("r2");
  });

  test("hold_unit 写出与现有 review-holds.json 同形的条目", async () => {
    repoFiles["data/realBank/review-holds.json"] = { content: { holds: [] }, sha: "s2" };
    const res = await decisionRoute.POST(req("/x", {
      body: { action: "hold_unit", file: "reading/ap", id: "real_ap_x_1_101", scope: "question", q: 2, stem: "In the second paragraph", reason: "盲解不一致" },
    }));
    expect(res.status).toBe(200);
    expect(puts[0].path).toBe("data/realBank/review-holds.json");
    expect(puts[0].content.holds[0]).toEqual({
      file: "reading/ap", id: "real_ap_x_1_101", scope: "question", q: 2, stem: "In the second paragraph", reason: "盲解不一致",
    });
  });

  test("question 级缺 q / stem → 400；未知 file / action → 400", async () => {
    repoFiles["data/realBank/review-holds.json"] = { content: { holds: [] }, sha: "s2" };
    const bad = (body) => decisionRoute.POST(req("/x", { body }));
    expect((await bad({ action: "hold_unit", file: "reading/ap", id: "x", scope: "question", reason: "r" })).status).toBe(400);
    expect((await bad({ action: "hold_unit", file: "reading/ap", id: "x", scope: "question", q: 1, reason: "r" })).status).toBe(400);
    expect((await bad({ action: "hold_unit", file: "evil/../x", id: "x", scope: "unit", reason: "r" })).status).toBe(400);
    expect((await bad({ action: "hold_unit", file: "reading/ap", id: "x", scope: "unit" })).status).toBe(400);
    expect((await bad({ action: "nope" })).status).toBe(400);
    expect(puts).toHaveLength(0);
  });
});
