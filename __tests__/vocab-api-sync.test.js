/** @jest-environment node */

const mockRows = new Map();
let mockBeforeUpdate = null;
let mockBeforeInsert = null;

jest.mock('../lib/supabaseAdmin', () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    from(table) {
      if (table !== 'vocab_cards') throw new Error(`unexpected table ${table}`);
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
      function run(single) {
        if (mode === 'insert') {
          mockBeforeInsert?.(payload);
          const key = `${payload.user_code}|${payload.word}`;
          if (mockRows.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          mockRows.set(key, { ...payload, version: 0 });
          return { data: null, error: null };
        }
        if (mode === 'update') mockBeforeUpdate?.();
        let rows = [...mockRows.values()].filter((r) => filters.every((fn) => fn(r)));
        if (order) rows.sort((a, b) => a[order].localeCompare(b[order]));
        if (max != null) rows = rows.slice(0, max);
        if (mode === 'update') {
          for (const r of rows) mockRows.set(`${r.user_code}|${r.word}`, { ...r, ...payload, version: r.version + 1 });
          return { data: rows.map((r) => ({ version: r.version + 1 })), error: null };
        }
        const data = rows.map((r) => structuredClone(r));
        return { data: single ? data[0] || null : data, error: null };
      }
      return builder;
    },
  },
}));

const { GET, POST } = require('../app/api/vocab/route');

function card(word, { updatedAt = '2026-01-01T00:00:00.000Z', readingUpdatedAt = updatedAt,
  reps = 0, listeningUpdatedAt = null, listeningReps = 0, deletedAt = null } = {}) {
  return { word, display: word, createdAt: '2025-01-01T00:00:00.000Z', updatedAt,
    readingUpdatedAt, reps, deletedAt,
    listeningState: listeningUpdatedAt ? { updatedAt: listeningUpdatedAt, reps: listeningReps } : null };
}

function put(c, version = 0) {
  mockRows.set(`TEST01|${c.word}`, { user_code: 'TEST01', word: c.word, card: c,
    updated_at: c.updatedAt, version });
}

function get(query = '') {
  return GET(new Request(`http://localhost/api/vocab?code=TEST01${query}`));
}

function post(cards) {
  return POST(new Request('http://localhost/api/vocab', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TEST01', cards }),
  }));
}

beforeEach(() => {
  mockRows.clear();
  mockBeforeUpdate = null;
  mockBeforeInsert = null;
});

test('word cursor pages cover more than 3000 cards including tombstones', async () => {
  for (let i = 0; i < 3501; i += 1) {
    put(card(`word${String(i).padStart(4, '0')}`, i === 3000 ? { deletedAt: '2026-01-02T00:00:00Z' } : {}));
  }
  let cursor = '';
  const words = [];
  do {
    const res = await get(`&limit=500${cursor ? `&cursor=${cursor}` : ''}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    words.push(...body.cards.map((c) => c.word));
    cursor = body.nextCursor;
  } while (cursor);
  expect(words).toHaveLength(3501);
  expect(new Set(words).size).toBe(3501);
  expect(words[3000]).toBe('word3000');
  const legacy = await (await get()).json();
  expect(legacy.cards).toHaveLength(3501);
});

test('stale POST preserves newer reading progress and newer incoming listening progress', async () => {
  put(card('alpha', { updatedAt: '2026-02-01T00:00:00Z', readingUpdatedAt: '2026-02-01T00:00:00Z',
    reps: 3, listeningUpdatedAt: '2026-01-01T00:00:00Z', listeningReps: 1 }));
  const incoming = card('alpha', { updatedAt: '2026-01-20T00:00:00Z',
    readingUpdatedAt: '2026-01-15T00:00:00Z', reps: 1,
    listeningUpdatedAt: '2026-02-02T00:00:00Z', listeningReps: 5 });
  const res = await post([incoming]);
  expect(res.status).toBe(200);
  const saved = mockRows.get('TEST01|alpha');
  expect(saved.card.reps).toBe(3);
  expect(saved.card.listeningState.reps).toBe(5);
  expect(saved.version).toBe(1);
});

test('duplicate words within one POST merge both review modes', async () => {
  const reading = card('alpha', { updatedAt: '2026-02-01T00:00:00Z',
    readingUpdatedAt: '2026-02-01T00:00:00Z', reps: 3 });
  const listening = card('alpha', { updatedAt: '2026-02-02T00:00:00Z',
    readingUpdatedAt: '2026-01-01T00:00:00Z', reps: 0,
    listeningUpdatedAt: '2026-02-02T00:00:00Z', listeningReps: 5 });
  const res = await post([reading, listening]);
  expect(res.status).toBe(200);
  const saved = mockRows.get('TEST01|alpha');
  expect(saved.card.reps).toBe(3);
  expect(saved.card.listeningState.reps).toBe(5);
});

test('CAS conflict rereads and merges a concurrent reading update', async () => {
  put(card('alpha', { reps: 1 }));
  mockBeforeUpdate = () => {
    mockBeforeUpdate = null;
    const concurrent = card('alpha', { updatedAt: '2026-02-03T00:00:00Z',
      readingUpdatedAt: '2026-02-03T00:00:00Z', reps: 4 });
    put(concurrent, 1);
  };
  const incoming = card('alpha', { updatedAt: '2026-02-02T00:00:00Z',
    listeningUpdatedAt: '2026-02-02T00:00:00Z', listeningReps: 2 });
  const res = await post([incoming]);
  expect(res.status).toBe(200);
  const saved = mockRows.get('TEST01|alpha');
  expect(saved.card.reps).toBe(4);
  expect(saved.card.listeningState.reps).toBe(2);
  expect(saved.version).toBe(2);
});

test('insert conflict retries against the row created by another request', async () => {
  mockBeforeInsert = () => {
    mockBeforeInsert = null;
    put(card('alpha', { reps: 3, updatedAt: '2026-02-01T00:00:00Z' }));
  };
  const res = await post([card('alpha', { listeningUpdatedAt: '2026-02-02T00:00:00Z', listeningReps: 2 })]);
  expect(res.status).toBe(200);
  const saved = mockRows.get('TEST01|alpha');
  expect(saved.card.reps).toBe(3);
  expect(saved.card.listeningState.reps).toBe(2);
});

test('repeated CAS conflicts return a retryable error without overwriting the concurrent row', async () => {
  put(card('alpha', { reps: 1 }));
  mockBeforeUpdate = () => {
    const old = mockRows.get('TEST01|alpha');
    mockRows.set('TEST01|alpha', { ...old, version: old.version + 1 });
  };
  const res = await post([card('alpha', { updatedAt: '2026-02-02T00:00:00Z',
    listeningUpdatedAt: '2026-02-02T00:00:00Z', listeningReps: 2 })]);
  expect(res.status).toBe(503);
  expect((await res.json()).error).toMatch(/retry sync/);
  expect(mockRows.get('TEST01|alpha').card.listeningState).toBeNull();
});

test('invalid pagination size is rejected', async () => {
  const res = await get('&limit=501');
  expect(res.status).toBe(400);
});

test('card byte limit counts UTF-8 bytes', async () => {
  const res = await post([{ ...card('alpha'), def: '汉'.repeat(3000) }]);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/card too large/);
});
