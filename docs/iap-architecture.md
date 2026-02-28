# IAP Architecture (Extensible Skeleton)

## Module layout

- `lib/iap/catalog.js`
  - Product catalog source.
  - Supports default products and `IAP_PRODUCTS_JSON`.
- `lib/iap/providers/*`
  - Provider abstraction layer.
  - Current implementation: `mockProvider`.
  - Future providers: `stripeProvider`, `appleProvider`, `googlePlayProvider`.
- `lib/iap/repository.js`
  - Entitlement persistence + webhook idempotency tracking.
  - Uses Supabase when configured; otherwise falls back to in-memory store.
- `lib/iap/service.js`
  - Core business orchestration:
    - list products
    - create checkout session
    - process webhook events
    - query user entitlements

## API surface

- `GET /api/iap/config`
- `GET /api/iap/products`
- `POST /api/iap/checkout`
- `POST /api/iap/webhook`
- `GET /api/iap/entitlements?userCode=...`
- `POST /api/iap/mock-webhook` (dev simulation, opt-in via env)

## Data model

Run SQL: `scripts/sql/iap-schema.sql`

- `iap_entitlements`
  - Source of truth for user purchase rights.
- `iap_webhook_events`
  - Idempotency ledger to prevent repeated processing.

## Provider contract (expected behavior)

Each provider should implement:

1. `createCheckoutSession(input)`
2. `verifyWebhook({ headers, rawBody })`
3. `parseWebhookEvent(rawBody)`

`parseWebhookEvent` should normalize to:

```json
{
  "provider": "stripe",
  "eventId": "evt_xxx",
  "eventType": "checkout.completed",
  "payload": {
    "userCode": "ABC123",
    "productId": "pro_monthly",
    "providerRef": "sub_xxx",
    "purchasedAt": "2026-02-27T00:00:00.000Z"
  }
}
```

## Upgrade path

1. Add provider implementation under `lib/iap/providers/`.
2. Register provider switch in `lib/iap/providers/index.js`.
3. Keep webhook payload normalization stable.
4. Add provider-specific metadata fields without changing entitlement core shape.
5. Add migration scripts only when new query dimensions are needed.

## Operational notes

- Keep production off until launch:
  - `NEXT_PUBLIC_IAP_ENABLED=false`
  - `IAP_ENABLED=false`
- For local/dev simulation:
  - `IAP_ALLOW_MOCK_WEBHOOK_SIMULATION=true`
- For real providers:
  - disable `/api/iap/mock-webhook`
  - enforce provider webhook signature verification

