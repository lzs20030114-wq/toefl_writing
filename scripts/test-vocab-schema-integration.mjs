import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const freshSql = await readFile(new URL('./sql/vocab-notebook.sql', import.meta.url), 'utf8');
const hardenSql = await readFile(new URL('./sql/vocab-sync-hardening.sql', import.meta.url), 'utf8');
const versionSql = await readFile(new URL('./sql/vocab-cas-version.sql', import.meta.url), 'utf8');

async function prepare(db) {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.users (code text PRIMARY KEY);
    INSERT INTO public.users(code) VALUES ('TEST01');
  `);
}

async function assertLocked(db) {
  const { rows } = await db.query(`
    SELECT
      has_table_privilege('anon', 'public.vocab_cards', 'SELECT') AS anon_cards,
      has_table_privilege('authenticated', 'public.vocab_review_logs', 'INSERT') AS auth_logs,
      has_table_privilege('service_role', 'public.vocab_cards', 'SELECT') AS service_read,
      has_table_privilege('service_role', 'public.vocab_cards', 'INSERT') AS service_insert,
      has_table_privilege('service_role', 'public.vocab_cards', 'UPDATE') AS service_update,
      has_table_privilege('service_role', 'public.vocab_review_logs', 'INSERT') AS service_logs,
      has_sequence_privilege('anon', 'public.vocab_cards_id_seq', 'USAGE') AS anon_seq,
      has_sequence_privilege('service_role', 'public.vocab_cards_id_seq', 'USAGE') AS service_seq;
  `);
  assert.deepEqual(rows[0], {
    anon_cards: false, auth_logs: false, service_read: true,
    service_insert: true, service_update: true, service_logs: true,
    anon_seq: false, service_seq: true,
  });
  const policies = await db.query(`SELECT tablename FROM pg_policies WHERE schemaname='public' AND tablename IN ('vocab_cards','vocab_review_logs')`);
  assert.equal(policies.rows.length, 0);
}

async function assertRoleBehavior(db) {
  const functions = await db.query(`SELECT
    has_function_privilege('anon', 'public.vocab_cards_bump_version()', 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', 'public.vocab_cards_bump_version()', 'EXECUTE') AS auth_exec,
    has_function_privilege('service_role', 'public.vocab_cards_bump_version()', 'EXECUTE') AS service_exec`);
  assert.deepEqual(functions.rows[0], { anon_exec: false, auth_exec: false, service_exec: true });
  await db.exec('SET ROLE service_role');
  try {
    await db.exec(`INSERT INTO public.vocab_cards(user_code,word,card) VALUES ('TEST01','role-write','{"word":"role-write"}')`);
    await db.exec(`UPDATE public.vocab_cards SET card='{"word":"role-write","updatedAt":"changed"}' WHERE word='role-write'`);
    await db.exec(`INSERT INTO public.vocab_review_logs(user_code,word,rating,state,reviewed_at) VALUES ('TEST01','role-write',3,'review',now())`);
    const row = await db.query(`SELECT version FROM public.vocab_cards WHERE word='role-write'`);
    assert.equal(Number(row.rows[0].version), 1);
  } finally {
    await db.exec('RESET ROLE');
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(db.query(`SELECT * FROM public.vocab_cards LIMIT 1`), /permission denied/);
      await assert.rejects(db.query(`SELECT * FROM public.vocab_review_logs LIMIT 1`), /permission denied/);
      await assert.rejects(db.exec(`INSERT INTO public.vocab_cards(user_code,word,card) VALUES ('TEST01','forbidden','{}')`), /permission denied/);
      await assert.rejects(db.exec(`INSERT INTO public.vocab_review_logs(user_code,word,rating,state,reviewed_at) VALUES ('TEST01','forbidden',3,'review',now())`), /permission denied/);
    } finally {
      await db.exec('RESET ROLE');
    }
  }
}

// Upgrade an old installation with public grants and permissive policies.
{
  const db = new PGlite();
  await prepare(db);
  await db.exec(`
    CREATE TABLE public.vocab_cards (
      id BIGSERIAL PRIMARY KEY, user_code text NOT NULL REFERENCES public.users(code),
      word text NOT NULL, card jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_code, word));
    CREATE TABLE public.vocab_review_logs (
      id BIGSERIAL PRIMARY KEY, user_code text NOT NULL REFERENCES public.users(code),
      word text NOT NULL, rating smallint NOT NULL, state text NOT NULL, reviewed_at timestamptz NOT NULL,
      UNIQUE(user_code, word, reviewed_at));
    ALTER TABLE public.vocab_cards ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vocab_review_logs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Allow all operations on vocab_cards" ON public.vocab_cards FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "Allow all operations on vocab_review_logs" ON public.vocab_review_logs FOR ALL USING (true) WITH CHECK (true);
    GRANT ALL ON public.vocab_cards, public.vocab_review_logs TO anon, authenticated;
    GRANT USAGE ON SEQUENCE public.vocab_cards_id_seq, public.vocab_review_logs_id_seq TO anon, authenticated;
    INSERT INTO public.vocab_cards(user_code, word, card) VALUES ('TEST01', 'alpha', '{"word":"alpha"}');
  `);
  await db.exec(hardenSql);
  await db.exec(hardenSql);
  await assertLocked(db);
  await db.exec(versionSql);
  await db.exec(versionSql);
  await assertRoleBehavior(db);
  const row = await db.query(`SELECT card, version FROM public.vocab_cards WHERE word='alpha'`);
  assert.equal(row.rows[0].card.word, 'alpha');
  assert.equal(Number(row.rows[0].version), 0);
  const won = await db.query(`UPDATE public.vocab_cards SET card='{"word":"alpha","updatedAt":"new"}' WHERE word='alpha' AND version=0 RETURNING version`);
  const lost = await db.query(`UPDATE public.vocab_cards SET card='{"word":"alpha","updatedAt":"old"}' WHERE word='alpha' AND version=0 RETURNING version`);
  assert.equal(won.rows.length, 1);
  assert.equal(Number(won.rows[0].version), 1);
  assert.equal(lost.rows.length, 0);
  await db.close();
}

// Fresh install must never recreate a public policy; hardening remains repeatable.
{
  const db = new PGlite();
  await prepare(db);
  await db.exec(freshSql);
  await assertLocked(db);
  await db.exec(hardenSql);
  await db.exec(versionSql);
  await assertLocked(db);
  await assertRoleBehavior(db);
  await db.close();
}

console.log('vocab SQL: fresh install, hardening, privileges, and CAS passed');
