import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(resolve(process.cwd(), "scripts/sql/credits-schema.sql"), "utf8");
const DAY = 86400_000;

function iso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * DAY).toISOString();
}

async function jsonRpc(db, sql, params) {
  const result = await db.query(sql, params);
  return result.rows[0].result;
}

function refresh(db, { code, points = 100, start, end, key }) {
  return jsonRpc(
    db,
    "SELECT public.credit_refresh_subscription($1,$2,$3::timestamptz,$4::timestamptz,$5,$6::jsonb) AS result",
    [code, points, start, end, key, "{}"],
  );
}

function grantPurchased(db, { code, points, key }) {
  return jsonRpc(
    db,
    "SELECT public.credit_grant_purchased($1,$2,$3,$4,$5::jsonb) AS result",
    [code, points, "top_up_purchase", key, "{}"],
  );
}

function consume(db, { code, points, key, action = "ai_grading" }) {
  return jsonRpc(
    db,
    "SELECT public.credit_consume($1,$2,$3,$4,$5::jsonb) AS result",
    [code, points, action, key, "{}"],
  );
}

function refund(db, { code, originalKey, key }) {
  return jsonRpc(
    db,
    "SELECT public.credit_refund($1,$2,$3,$4::jsonb) AS result",
    [code, originalKey, key, "{}"],
  );
}

function wallet(db, code) {
  return jsonRpc(db, "SELECT public.credit_wallet_snapshot($1) AS result", [code]);
}

const db = new PGlite();

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.users (code TEXT PRIMARY KEY);
    INSERT INTO public.users(code) VALUES
      ('RPLY01'), ('ROLL01'), ('BKT001'), ('LATE01'), ('EMPTY1'), ('RLS001');
  `);

  // 1. The actual migration executes and can safely be rerun.
  await db.exec(migration);
  await db.exec(migration);
  assert.equal((await wallet(db, "RLS001")).totalPoints, 0);

  // 2. A same-period replay with a different key cannot restore spent points.
  const replayStart = iso(-1);
  const replayEnd = iso(29);
  await refresh(db, { code: "RPLY01", start: replayStart, end: replayEnd, key: "refresh:rply:first" });
  await consume(db, { code: "RPLY01", points: 40, key: "consume:rply:1" });
  const replay = await refresh(db, {
    code: "RPLY01", start: replayStart, end: replayEnd, key: "refresh:rply:replay",
  });
  assert.equal(replay.duplicate, true);
  assert.equal((await wallet(db, "RPLY01")).subscriptionPoints, 60);

  // 3. Changed idempotency payloads and stale periods are rejected.
  await assert.rejects(
    refresh(db, {
      code: "RPLY01", points: 99, start: replayStart, end: replayEnd, key: "refresh:rply:first",
    }),
    /idempotency key conflict/i,
  );
  await assert.rejects(
    refresh(db, {
      code: "RPLY01", start: iso(-2), end: iso(10), key: "refresh:rply:stale",
    }),
    /stale subscription period/i,
  );
  await assert.rejects(
    refresh(db, {
      code: "EMPTY1", start: iso(-10), end: iso(-2), key: "refresh:empty:ended",
    }),
    /subscription period has ended/i,
  );

  // 4. Rollover expiry and grant are separately reconcilable.
  await refresh(db, {
    code: "ROLL01", start: iso(-2), end: iso(1), key: "refresh:roll:old",
  });
  await refresh(db, {
    code: "ROLL01", start: iso(-1), end: iso(29), key: "refresh:roll:new",
  });
  const rolloverLedger = await db.query(`
    SELECT operation, subscription_delta
    FROM public.credit_ledger
    WHERE user_code = 'ROLL01'
  `);
  const rolloverEntries = rolloverLedger.rows
    .map((row) => [row.operation, row.subscription_delta])
    .sort(([operationA], [operationB]) => operationA.localeCompare(operationB));
  assert.deepEqual(rolloverEntries, [
    ["expire", -100],
    ["subscription_refresh", 100],
    ["subscription_refresh", 100],
  ]);
  assert.equal(rolloverLedger.rows.reduce((sum, row) => sum + row.subscription_delta, 0), 100);
  assert.equal((await wallet(db, "ROLL01")).subscriptionPoints, 100);

  // 5. Active-period refunds restore the original buckets once.
  await refresh(db, {
    code: "BKT001", start: iso(-1), end: iso(29), key: "refresh:bkt:1",
  });
  await grantPurchased(db, { code: "BKT001", points: 50, key: "purchase:bkt:1" });
  const charged = await consume(db, { code: "BKT001", points: 120, key: "consume:bkt:1" });
  assert.equal(charged.subscriptionPointsUsed, 100);
  assert.equal(charged.purchasedPointsUsed, 20);
  const firstRefund = await refund(db, {
    code: "BKT001", originalKey: "consume:bkt:1", key: "refund:bkt:1",
  });
  const retryRefund = await refund(db, {
    code: "BKT001", originalKey: "consume:bkt:1", key: "refund:bkt:retry",
  });
  assert.equal(firstRefund.duplicate, false);
  assert.equal(retryRefund.duplicate, true);
  assert.deepEqual(
    (({ subscriptionPoints, purchasedPoints, totalPoints }) => ({ subscriptionPoints, purchasedPoints, totalPoints }))(
      await wallet(db, "BKT001"),
    ),
    { subscriptionPoints: 100, purchasedPoints: 50, totalPoints: 150 },
  );

  // 6. A delayed refund becomes purchased credit instead of inflating a new period.
  await refresh(db, {
    code: "LATE01", start: iso(-2), end: iso(1), key: "refresh:late:old",
  });
  await consume(db, { code: "LATE01", points: 40, key: "consume:late:old" });
  await refresh(db, {
    code: "LATE01", start: iso(-1), end: iso(29), key: "refresh:late:new",
  });
  await refund(db, {
    code: "LATE01", originalKey: "consume:late:old", key: "refund:late:old",
  });
  const delayedWallet = await wallet(db, "LATE01");
  assert.equal(delayedWallet.subscriptionPoints, 100);
  assert.equal(delayedWallet.purchasedPoints, 40);
  const delayedRefund = await db.query(`
    SELECT subscription_delta, purchased_delta, metadata
    FROM public.credit_ledger
    WHERE idempotency_key = 'refund:late:old'
  `);
  assert.equal(delayedRefund.rows[0].subscription_delta, 0);
  assert.equal(delayedRefund.rows[0].purchased_delta, 40);
  assert.equal(delayedRefund.rows[0].metadata.subscriptionRefundConvertedToPurchased, true);

  // 7. Insufficient balance creates no consumption ledger entry.
  const denied = await consume(db, { code: "EMPTY1", points: 1, key: "consume:empty:1" });
  assert.equal(denied.allowed, false);
  const deniedRows = await db.query(
    "SELECT COUNT(*)::int AS count FROM public.credit_ledger WHERE user_code = 'EMPTY1'",
  );
  assert.equal(deniedRows.rows[0].count, 0);

  // 8. Browser roles can neither read storage nor invoke RPCs.
  await db.exec("SET ROLE anon");
  try {
    await assert.rejects(db.query("SELECT * FROM public.credit_wallets"), /permission denied/i);
    await assert.rejects(
      db.query("SELECT public.credit_wallet_snapshot('RLS001')"),
      /permission denied/i,
    );
  } finally {
    await db.exec("RESET ROLE");
  }

  process.stdout.write(`${JSON.stringify({ ok: true, checks: 8 })}\n`);
} finally {
  await db.close();
}
