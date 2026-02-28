# IAP Release Playbook (Staged, No Immediate Production Push)

## 1) Branch strategy

Use a long-running feature branch for all IAP work:

```bash
git checkout -b feature/iap-system
```

Keep production deployments tied to `main` only. Do not merge this branch until release day.

## 2) Feature-flag strategy

The project now supports IAP gating:

- `NEXT_PUBLIC_IAP_ENABLED` controls client-side exposure (menu/entry visibility).
- `IAP_ENABLED` controls server-side behavior.

Recommended values by environment:

- Production (before launch): `NEXT_PUBLIC_IAP_ENABLED=false`, `IAP_ENABLED=false`
- Preview/dev for IAP testing: `NEXT_PUBLIC_IAP_ENABLED=true`, `IAP_ENABLED=true`

## 3) What is already wired

- IAP page route: `/iap` (returns 404 when flag is off)
- IAP config API: `/api/iap/config` (returns `{ enabled: boolean }`)
- IAP APIs:
  - `GET /api/iap/products`
  - `POST /api/iap/checkout`
  - `POST /api/iap/webhook`
  - `GET /api/iap/entitlements?userCode=...`
  - `POST /api/iap/mock-webhook` (dev simulation only)
- Shared flag helper: `lib/featureFlags.js`
- Core architecture doc: `docs/iap-architecture.md`
- SQL schema: `scripts/sql/iap-schema.sql`

## 4) Daily development flow

```bash
git checkout feature/iap-system
git add .
git commit -m "feat(iap): ..."
git push origin feature/iap-system
```

Use preview deployments from this branch for testing. Keep production untouched.

For local simulation only:

```bash
IAP_ALLOW_MOCK_WEBHOOK_SIMULATION=true
```

## 5) Launch day flow

1. Merge `feature/iap-system` into `main`.
2. Set production envs to:
   - `NEXT_PUBLIC_IAP_ENABLED=true`
   - `IAP_ENABLED=true`
3. Trigger production deploy.
4. Validate:
   - `/iap` is accessible
   - `/api/iap/config` returns `enabled: true`

## 6) Fast rollback

If incidents occur after launch:

1. Flip production envs back to `false`.
2. Redeploy.
3. Investigate while public IAP paths are hidden again.
