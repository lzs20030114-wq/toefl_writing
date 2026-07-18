/**
 * @jest-environment node
 */

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

test("credits migration and RPCs pass real PostgreSQL-compatible behavior checks", () => {
  const script = resolve(process.cwd(), "scripts/test-credits-schema-integration.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Credits schema integration failed:\n${result.stdout}\n${result.stderr}`);
  }

  expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true, checks: 8 });
}, 35000);
