#!/usr/bin/env node
/**
 * End-to-end webhook test script.
 * Tests against the live deployment.
 *
 * Usage: node scripts/test-webhook.mjs
 */

const BASE = "https://treepractice.com";
const TEST_CODE = "GUHUCB"; // Must exist in DB

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "follow",
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "follow" });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function afdianPayload(orderId, { month = 1, amount = "29.99", remark = TEST_CODE, status = 2, productType = 0 } = {}) {
  return {
    ec: 200, em: "ok",
    data: {
      type: "order",
      order: {
        out_trade_no: orderId,
        user_id: "testuser",
        plan_id: "",
        month,
        total_amount: amount,
        show_amount: amount,
        status,
        remark,
        product_type: productType,
      },
    },
  };
}

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function getUserInfo(code) {
  const { data } = await get(`/api/auth/user-info?code=${code}`);
  return data;
}

// ═══════════════════════════════════
// Test cases
// ═══════════════════════════════════

async function testBasicWebhook() {
  console.log("\n🔹 Test 1: Basic webhook response format");
  const { status, data } = await post("/api/iap/webhook", afdianPayload("e2e_basic_001"));
  assert("HTTP 200", status === 200);
  assert("Returns {ec:200, em:''}", data?.ec === 200 && data?.em === "");
}

async function testMonthlyPlan() {
  console.log("\n🔹 Test 2: Monthly plan (month=1, ¥29.99) → 30 days");
  const orderId = `e2e_monthly_${Date.now()}`;
  const { data } = await post("/api/iap/webhook", afdianPayload(orderId, { month: 1, amount: "29.99" }));
  assert("Webhook accepted", data?.ec === 200);

  const user = await getUserInfo(TEST_CODE);
  assert("Tier is pro", user?.tier === "pro");
  assert("tier_expires_at is set", !!user?.tier_expires_at);
  if (user?.tier_expires_at) {
    const expires = new Date(user.tier_expires_at);
    const daysFromNow = (expires - Date.now()) / (1000 * 60 * 60 * 24);
    assert(`Expires in ~30 days (got ${daysFromNow.toFixed(1)})`, daysFromNow > 25 && daysFromNow < 35);
  }
}

async function testDuplicateOrder() {
  console.log("\n🔹 Test 3: Duplicate order ID → idempotent (no double grant)");
  const orderId = `e2e_dup_${Date.now()}`;
  const r1 = await post("/api/iap/webhook", afdianPayload(orderId, { month: 1 }));
  assert("First call accepted", r1.data?.ec === 200);

  const user1 = await getUserInfo(TEST_CODE);
  const expires1 = user1?.tier_expires_at;

  const r2 = await post("/api/iap/webhook", afdianPayload(orderId, { month: 1 }));
  assert("Second call accepted (same format)", r2.data?.ec === 200);

  const user2 = await getUserInfo(TEST_CODE);
  assert("tier_expires_at unchanged (idempotent)", user2?.tier_expires_at === expires1);
}

async function testQuarterlyPlan() {
  console.log("\n🔹 Test 4: Quarterly plan (month=3, ¥69.97) → 90 days stacked");
  const orderId = `e2e_quarterly_${Date.now()}`;
  const userBefore = await getUserInfo(TEST_CODE);
  const expBefore = new Date(userBefore?.tier_expires_at || Date.now());

  const { data } = await post("/api/iap/webhook", afdianPayload(orderId, { month: 3, amount: "69.97" }));
  assert("Webhook accepted", data?.ec === 200);

  const userAfter = await getUserInfo(TEST_CODE);
  const expAfter = new Date(userAfter?.tier_expires_at);
  const addedDays = (expAfter - expBefore) / (1000 * 60 * 60 * 24);
  assert(`Stacked ~90 days on top (got +${addedDays.toFixed(1)})`, addedDays > 85 && addedDays < 95);
}

async function testYearlyPlan() {
  console.log("\n🔹 Test 5: Yearly plan (month=12, ¥259.88) → 365 days stacked");
  const orderId = `e2e_yearly_${Date.now()}`;
  const userBefore = await getUserInfo(TEST_CODE);
  const expBefore = new Date(userBefore?.tier_expires_at || Date.now());

  const { data } = await post("/api/iap/webhook", afdianPayload(orderId, { month: 12, amount: "259.88" }));
  assert("Webhook accepted", data?.ec === 200);

  const userAfter = await getUserInfo(TEST_CODE);
  const expAfter = new Date(userAfter?.tier_expires_at);
  const addedDays = (expAfter - expBefore) / (1000 * 60 * 60 * 24);
  assert(`Stacked ~365 days (got +${addedDays.toFixed(1)})`, addedDays > 360 && addedDays < 370);
}

async function testWeeklyPlan() {
  console.log("\n🔹 Test 6: Weekly trial (month=0, ¥9.99) → 7 days stacked");
  const orderId = `e2e_weekly_${Date.now()}`;
  const userBefore = await getUserInfo(TEST_CODE);
  const expBefore = new Date(userBefore?.tier_expires_at || Date.now());

  const { data } = await post("/api/iap/webhook", afdianPayload(orderId, { month: 0, amount: "9.99", productType: 1 }));
  assert("Webhook accepted", data?.ec === 200);

  const userAfter = await getUserInfo(TEST_CODE);
  const expAfter = new Date(userAfter?.tier_expires_at);
  const addedDays = (expAfter - expBefore) / (1000 * 60 * 60 * 24);
  assert(`Stacked ~7 days (got +${addedDays.toFixed(1)})`, addedDays > 5 && addedDays < 10);
}

async function testNoRemarkCode() {
  console.log("\n🔹 Test 7: No user code in remark → graceful failure");
  const orderId = `e2e_noremark_${Date.now()}`;
  const { status, data } = await post("/api/iap/webhook", afdianPayload(orderId, { remark: "感谢支持" }));
  assert("HTTP 200 (no crash)", status === 200);
  assert("Still returns {ec:200}", data?.ec === 200);
}

async function testInvalidUserCode() {
  console.log("\n🔹 Test 8: Non-existent user code → webhook accepts but no upgrade");
  const orderId = `e2e_badcode_${Date.now()}`;
  const { status, data } = await post("/api/iap/webhook", afdianPayload(orderId, { remark: "ZZZZZZ" }));
  assert("HTTP 200", status === 200);
  assert("Returns {ec:200}", data?.ec === 200);
}

async function testUnpaidOrder() {
  console.log("\n🔹 Test 9: Unpaid order (status=1) → ignored");
  const orderId = `e2e_unpaid_${Date.now()}`;
  const userBefore = await getUserInfo(TEST_CODE);
  const { data } = await post("/api/iap/webhook", afdianPayload(orderId, { status: 1 }));
  assert("Webhook accepted", data?.ec === 200);

  const userAfter = await getUserInfo(TEST_CODE);
  assert("tier_expires_at unchanged", userAfter?.tier_expires_at === userBefore?.tier_expires_at);
}

async function testMalformedBody() {
  console.log("\n🔹 Test 10: Malformed JSON body → no crash");
  const res = await fetch(`${BASE}/api/iap/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json at all",
    redirect: "follow",
  });
  const data = await res.json().catch(() => null);
  assert("HTTP 200 (graceful)", res.status === 200);
  assert("Returns {ec:200}", data?.ec === 200);
}

async function testEmptyOrder() {
  console.log("\n🔹 Test 11: Missing order object → graceful");
  const { status, data } = await post("/api/iap/webhook", { ec: 200, em: "ok", data: { type: "order" } });
  assert("HTTP 200", status === 200);
  assert("Returns {ec:200}", data?.ec === 200);
}

// ═══════════════════════════════════
// Run all tests
// ═══════════════════════════════════
async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  Afdian Webhook E2E Tests");
  console.log(`  Target: ${BASE}`);
  console.log(`  Test user: ${TEST_CODE}`);
  console.log("═══════════════════════════════════════");

  await testBasicWebhook();
  await testMonthlyPlan();
  await testDuplicateOrder();
  await testQuarterlyPlan();
  await testYearlyPlan();
  await testWeeklyPlan();
  await testNoRemarkCode();
  await testInvalidUserCode();
  await testUnpaidOrder();
  await testMalformedBody();
  await testEmptyOrder();

  console.log("\n═══════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════");

  // Show final user state
  const finalUser = await getUserInfo(TEST_CODE);
  console.log(`\n  Final state of ${TEST_CODE}:`);
  console.log(`    tier: ${finalUser?.tier}`);
  console.log(`    expires: ${finalUser?.tier_expires_at}`);
  if (finalUser?.tier_expires_at) {
    const d = (new Date(finalUser.tier_expires_at) - Date.now()) / (1000 * 60 * 60 * 24);
    console.log(`    (~${d.toFixed(0)} days from now)`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
