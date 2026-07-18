import { isSupabaseAdminConfigured, supabaseAdmin } from "../supabaseAdmin";
import { CreditError, normalizeUserCode } from "./errors";

function requireDatabase() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    throw new CreditError("CREDITS_DB_UNAVAILABLE", "Credits database is not configured", 503);
  }
  return supabaseAdmin;
}

async function callRpc(name, args) {
  const db = requireDatabase();
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const missingMigration = /function .* does not exist|schema cache/i.test(String(error.message || ""));
    throw new CreditError(
      missingMigration ? "CREDITS_MIGRATION_REQUIRED" : "CREDITS_DB_ERROR",
      error.message || `Credit operation ${name} failed`,
      missingMigration ? 503 : 500,
    );
  }
  return data;
}

export const creditRepository = {
  getWallet(userCode) {
    return callRpc("credit_wallet_snapshot", { p_user_code: normalizeUserCode(userCode) });
  },

  refreshSubscription({ userCode, points, periodStart, periodEnd, idempotencyKey, metadata = {} }) {
    return callRpc("credit_refresh_subscription", {
      p_user_code: normalizeUserCode(userCode),
      p_points: points,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata,
    });
  },

  grantPurchased({ userCode, points, action, idempotencyKey, metadata = {} }) {
    return callRpc("credit_grant_purchased", {
      p_user_code: normalizeUserCode(userCode),
      p_points: points,
      p_action: action,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata,
    });
  },

  consume({ userCode, points, action, idempotencyKey, metadata = {} }) {
    return callRpc("credit_consume", {
      p_user_code: normalizeUserCode(userCode),
      p_points: points,
      p_action: action,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata,
    });
  },

  refund({ userCode, originalIdempotencyKey, idempotencyKey, metadata = {} }) {
    return callRpc("credit_refund", {
      p_user_code: normalizeUserCode(userCode),
      p_original_idempotency_key: originalIdempotencyKey,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata,
    });
  },
};

