/** @jest-environment node */

const mockRows = new Map();
let mockBeforeUpdate = null;
let mockBeforeInsert = null;

jest.mock('../lib/supabaseAdmin', () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    from(table) {
      if (table !== 'real_bank_favorites') throw new Error(`unexpected table ${table}`);
      let mode = 'read';
      let payload;
      let filters = [];
      let order = null;
      let max = null;
      const builder = {
        select() { return builder; },
        eq(field, value) { filters.push((r) => r[field] === value); return builder; },
        in(field, values) { filters.push((r) => values.includes(r[field])); return builder; },
        gt(field, value) { filters.push((r) => r[field] > value); return builder; },
        order(field) { order = field; return builder; },
        limit(value) { max = value; return builder; },
        insert(value) { mode = 'insert'; payload = value; return builder; },
        update(value) { mode = 'update'; payload = value; return builder; },
        maybeSingle() { return Promise.resolve(run(true)); },
        then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
      };
      async function run(single) {
        if (mode === 'insert') {
          await mockBeforeInsert?.(payload);
          const key = `${payload.user_code}|${payload.fav_key}`;
          if (mockRows.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          mockRows.set(key, { ...payload, version: 0 });
          return { data: null, error: null };
        }
        if (mode === 'update') await mockBeforeUpdate?.();
        let rows = [...mockRows.values()].filter((r) => filters.every((fn) => fn(r)));
        if (order) rows.sort((a, b) => a[order].localeCompare(b[order]));
        if (max != null) rows = rows.slice(0, max);
        if (mode === 'update') {
          for (const r of rows) mockRows.set(`${r.user_code}|${r.fav_key}`, { ...r, ...payload, version: r.version + 1 });
          return { data: rows.map((r) => ({ fav_key: r.fav_key })), error: null };
        }
        const data = rows.map((r) => structuredClone(r));
        return { data: single ? data[0] || null : data, error: null };
      }
      return builder;
    },
  },
}));

const { POST } = require('../app/api/real-favorites/route');
const { toFavRow } = require('../lib/realBankFavoriteRow');
const key = 'ap:real_test';
function favorite(day, deleted = false) {
  const updatedAt = `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  return { key, subtype: 'ap', itemId: 'real_test', updatedAt, deletedAt: deleted ? updatedAt : null };
}
function put(fav) { mockRows.set(`TEST01|${key}`, toFavRow('TEST01', fav).row); }
function post(fav) {
  return POST(new Request('http://localhost/api/real-favorites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TEST01', favorites: [fav] }),
  }));
}
beforeEach(() => { mockRows.clear(); mockBeforeUpdate = null; mockBeforeInsert = null; });

test('an older favorite paused after reading cannot overwrite a newer cancellation from another POST', async () => {
  put(favorite(1));
  mockBeforeUpdate = async () => {
    mockBeforeUpdate = null;
    expect((await post(favorite(3, true))).status).toBe(200);
  };
  const response = await post(favorite(2));
  expect(await response.json()).toEqual({ ok: true, saved: 0 });
  expect(mockRows.get(`TEST01|${key}`).fav).toEqual(favorite(3, true));
});

test('a concurrently inserted cancellation survives the old favorite insert conflict', async () => {
  mockBeforeInsert = async () => {
    mockBeforeInsert = null;
    expect((await post(favorite(3, true))).status).toBe(200);
  };
  expect(await (await post(favorite(2))).json()).toEqual({ ok: true, saved: 0 });
  expect(mockRows.get(`TEST01|${key}`).fav).toEqual(favorite(3, true));
});

test('a newer cancellation retries on the version written concurrently by an older favorite', async () => {
  put(favorite(1));
  mockBeforeUpdate = async () => {
    mockBeforeUpdate = null;
    expect((await post(favorite(2))).status).toBe(200);
  };
  expect(await (await post(favorite(3, true))).json()).toEqual({ ok: true, saved: 1 });
  expect(mockRows.get(`TEST01|${key}`).fav).toEqual(favorite(3, true));
});
