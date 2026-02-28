import { randomUUID } from "crypto";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../supabaseAdmin";

function getMemoryStore() {
  if (!globalThis.__iapStore) {
    globalThis.__iapStore = {
      entitlements: new Map(),
      processedEvents: new Set(),
    };
  }
  return globalThis.__iapStore;
}

function toPublicEntitlement(row) {
  return {
    id: String(row?.id || ""),
    userCode: String(row?.user_code || "").toUpperCase(),
    productId: String(row?.product_id || ""),
    status: String(row?.status || "active"),
    provider: String(row?.provider || "mock"),
    providerRef: String(row?.provider_ref || ""),
    grantedAt: row?.granted_at || row?.created_at || null,
    expiresAt: row?.expires_at || null,
    metadata: row?.metadata || {},
  };
}

function makeEntitlementRecord({ userCode, productId, provider, providerRef, metadata = {} }) {
  return {
    id: randomUUID(),
    user_code: String(userCode || "").trim().toUpperCase(),
    product_id: String(productId || "").trim(),
    status: "active",
    provider: String(provider || "mock"),
    provider_ref: String(providerRef || "").trim(),
    granted_at: new Date().toISOString(),
    expires_at: null,
    metadata,
  };
}

async function listEntitlementsSupabase(userCode) {
  const { data, error } = await supabaseAdmin
    .from("iap_entitlements")
    .select("id,user_code,product_id,status,provider,provider_ref,granted_at,expires_at,metadata,created_at")
    .eq("user_code", String(userCode || "").trim().toUpperCase())
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message || "Failed to query entitlements");
  return (data || []).map(toPublicEntitlement);
}

function listEntitlementsMemory(userCode) {
  const store = getMemoryStore();
  const code = String(userCode || "").trim().toUpperCase();
  return Array.from(store.entitlements.values())
    .filter((row) => row.user_code === code)
    .map(toPublicEntitlement);
}

async function grantEntitlementSupabase(input) {
  const record = makeEntitlementRecord(input);
  const { data, error } = await supabaseAdmin
    .from("iap_entitlements")
    .insert(record)
    .select("id,user_code,product_id,status,provider,provider_ref,granted_at,expires_at,metadata,created_at")
    .single();
  if (error) throw new Error(error.message || "Failed to grant entitlement");
  return toPublicEntitlement(data);
}

function grantEntitlementMemory(input) {
  const store = getMemoryStore();
  const record = makeEntitlementRecord(input);
  store.entitlements.set(record.id, record);
  return toPublicEntitlement(record);
}

async function markEventProcessedSupabase(provider, eventId) {
  const { error } = await supabaseAdmin.from("iap_webhook_events").insert({
    id: randomUUID(),
    provider: String(provider || "unknown"),
    event_id: String(eventId || ""),
    processed_at: new Date().toISOString(),
  });
  if (!error) return true;
  if (String(error.message || "").toLowerCase().includes("duplicate")) return false;
  throw new Error(error.message || "Failed to store webhook event");
}

function markEventProcessedMemory(provider, eventId) {
  const store = getMemoryStore();
  const key = `${String(provider || "unknown")}:${String(eventId || "")}`;
  if (store.processedEvents.has(key)) return false;
  store.processedEvents.add(key);
  return true;
}

export async function listEntitlementsByUser(userCode) {
  if (isSupabaseAdminConfigured) return listEntitlementsSupabase(userCode);
  return listEntitlementsMemory(userCode);
}

export async function grantEntitlement(input) {
  if (isSupabaseAdminConfigured) return grantEntitlementSupabase(input);
  return grantEntitlementMemory(input);
}

export async function markWebhookEventProcessed(provider, eventId) {
  if (isSupabaseAdminConfigured) return markEventProcessedSupabase(provider, eventId);
  return markEventProcessedMemory(provider, eventId);
}

