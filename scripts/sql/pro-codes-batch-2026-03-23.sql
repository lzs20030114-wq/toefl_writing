-- Auto-generated Pro login codes
-- Generated at: 2026-03-23T07:06:04.278Z
-- Total: 80 codes

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS pro_days INTEGER NULL;

-- ═══ 7-day Pro codes (20) ═══

INSERT INTO access_codes (code, status, issued_to, issued_at, pro_days, note) VALUES
  ('7AU2L3', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('7UWR3X', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('3YHHPH', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('3BJKT5', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('QVDFLF', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('F3KV4F', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('JDJCUF', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('JVG32Y', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('EKZZFF', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('WSQ9PN', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('AY3ULP', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('ZEL8J3', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('P24R2R', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('MRQR3Y', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('XDAPGP', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('RYSQCA', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('44UFMF', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('HHBUK3', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('SB4GWQ', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code'),
  ('EZY348', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 7, '7-day Pro code');

INSERT INTO users (code, status, tier, created_at) VALUES
  ('7AU2L3', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('7UWR3X', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('3YHHPH', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('3BJKT5', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('QVDFLF', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('F3KV4F', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('JDJCUF', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('JVG32Y', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('EKZZFF', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('WSQ9PN', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('AY3ULP', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('ZEL8J3', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('P24R2R', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('MRQR3Y', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('XDAPGP', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('RYSQCA', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('44UFMF', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('HHBUK3', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('SB4GWQ', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('EZY348', 'pending', 'pro', '2026-03-23T07:06:04.278Z')
ON CONFLICT (code) DO NOTHING;

-- ═══ 30-day Pro codes (20) ═══

INSERT INTO access_codes (code, status, issued_to, issued_at, pro_days, note) VALUES
  ('2PH4LL', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('WD6LPF', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('EBQ3Y2', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('7AEGT2', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('WDR5VP', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('S4MHLP', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('AGVBBE', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('E4JB3J', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('BC7PQ5', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('DDJWTZ', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('UFT3VR', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('TYLH2Y', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('SQLUE5', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('4EHRSR', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('ZVJ72C', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('YV9ZF8', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('KXHDX5', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('3Q53BJ', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('5J8VLP', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code'),
  ('2JG8L9', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 30, '30-day Pro code');

INSERT INTO users (code, status, tier, created_at) VALUES
  ('2PH4LL', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('WD6LPF', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('EBQ3Y2', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('7AEGT2', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('WDR5VP', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('S4MHLP', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('AGVBBE', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('E4JB3J', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('BC7PQ5', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('DDJWTZ', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('UFT3VR', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('TYLH2Y', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('SQLUE5', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('4EHRSR', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('ZVJ72C', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('YV9ZF8', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('KXHDX5', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('3Q53BJ', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('5J8VLP', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('2JG8L9', 'pending', 'pro', '2026-03-23T07:06:04.278Z')
ON CONFLICT (code) DO NOTHING;

-- ═══ 90-day Pro codes (20) ═══

INSERT INTO access_codes (code, status, issued_to, issued_at, pro_days, note) VALUES
  ('F7FBGQ', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('XQ6W5A', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('MAYMB9', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('F2E8CZ', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('TAJEBQ', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('T8VF9J', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('BLZQFK', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('FDETRV', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('6JA8SU', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('PMHGKT', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('M5DRMW', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('D2NBNH', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('D4F6TS', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('SQ8MJZ', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('R8T7CU', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('FQ8BCY', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('Z5M495', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('258DS2', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('2F9RVE', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code'),
  ('PS3Q4Q', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 90, '90-day Pro code');

INSERT INTO users (code, status, tier, created_at) VALUES
  ('F7FBGQ', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('XQ6W5A', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('MAYMB9', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('F2E8CZ', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('TAJEBQ', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('T8VF9J', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('BLZQFK', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('FDETRV', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('6JA8SU', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('PMHGKT', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('M5DRMW', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('D2NBNH', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('D4F6TS', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('SQ8MJZ', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('R8T7CU', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('FQ8BCY', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('Z5M495', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('258DS2', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('2F9RVE', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('PS3Q4Q', 'pending', 'pro', '2026-03-23T07:06:04.278Z')
ON CONFLICT (code) DO NOTHING;

-- ═══ 365-day Pro codes (20) ═══

INSERT INTO access_codes (code, status, issued_to, issued_at, pro_days, note) VALUES
  ('YRLSF5', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('Y5FKS6', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('QG6P2S', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('4LYD95', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('F7LDTF', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('HLQPH8', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('XL9YAL', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('YHH799', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('KL2TY7', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('X642T9', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('C24QHK', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('KSRAPF', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('4JE37K', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('2YWE3K', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('9MNX4K', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('9CXLQR', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('JQHHVP', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('LKTKYB', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('JYKN3W', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code'),
  ('6CBFSW', 'issued', 'pre-generated', '2026-03-23T07:06:04.278Z', 365, '365-day Pro code');

INSERT INTO users (code, status, tier, created_at) VALUES
  ('YRLSF5', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('Y5FKS6', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('QG6P2S', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('4LYD95', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('F7LDTF', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('HLQPH8', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('XL9YAL', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('YHH799', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('KL2TY7', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('X642T9', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('C24QHK', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('KSRAPF', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('4JE37K', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('2YWE3K', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('9MNX4K', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('9CXLQR', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('JQHHVP', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('LKTKYB', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('JYKN3W', 'pending', 'pro', '2026-03-23T07:06:04.278Z'),
  ('6CBFSW', 'pending', 'pro', '2026-03-23T07:06:04.278Z')
ON CONFLICT (code) DO NOTHING;

