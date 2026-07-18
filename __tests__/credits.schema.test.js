/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "scripts/sql/credits-schema.sql"), "utf8");

describe("credits SQL migration safety contract", () => {
  test("creates separate wallet buckets and an immutable-style ledger", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.credit_wallets/i);
    expect(sql).toMatch(/subscription_points INTEGER/i);
    expect(sql).toMatch(/purchased_points INTEGER/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.credit_ledger/i);
    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/i);
  });

  test("provides atomic grant, refresh, consume and refund operations", () => {
    expect(sql).toMatch(/FUNCTION public\.credit_refresh_subscription/i);
    expect(sql).toMatch(/FUNCTION public\.credit_grant_purchased/i);
    expect(sql).toMatch(/FUNCTION public\.credit_consume/i);
    expect(sql).toMatch(/FUNCTION public\.credit_refund/i);
    expect(sql).toMatch(/FOR UPDATE/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
  });

  test("keeps all database access service-role only", () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.credit_wallets FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.credit_consume[\s\S]+TO service_role/i);
  });
});

