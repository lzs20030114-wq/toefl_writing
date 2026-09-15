-- 手动发放自定义登录码 XXY123（legacy 权限 = 永久 Pro 级，无过期）
-- 创建日期: 2026-09-15
--
-- 为什么走 SQL 而不是 /admin-codes 后台：
--   1. 后台 generate 只能随机生成，字符集 CODE_CHARS 里没有 "1"，产不出 XXY123
--   2. 后台 issue 只能把已存在且 status='available' 的码改成 issued，不能凭空造码
--   3. 后台没有设置 tier='legacy' 的入口
--
-- 权限说明（见 app/api/auth/verify-code/route.js）：
--   · users.tier='legacy' → lib/dailyUsage.js 不限次、lib/userBankAuth.js 放行个人题库、
--     lib/speech/retentionPolicy.js 给满额语音配额，等同 pro
--   · 过期检查只对 tier='pro' 生效（`tier === "pro" && isExpired(tier_expires_at)`），
--     legacy 不看 tier_expires_at，所以这里留 NULL = 永不过期
--   · users.status 必须是 'active' 不能是 'pending'：pending 会走首登激活分支，
--     给账号盖上一个 now+pro_days 的 tier_expires_at（对 legacy 无害但会误导后台展示）
--   · access_codes.issued_to 特意写 'legacy-user'：verify-code 里这个值是 legacy 的兜底标记，
--     万一 users.tier 被改回 free/未知，下次登录会自动重新置回 legacy。真实来源记在 note 字段
--
-- 幂等：两条 INSERT 都带 ON CONFLICT DO UPDATE，重复执行安全（会把状态重新压回目标值）。

INSERT INTO access_codes (code, status, issued_to, issued_at, expires_at, note)
VALUES ('XXY123', 'issued', 'legacy-user', NOW(), NULL, '手动发放 · legacy 永久权限')
ON CONFLICT (code) DO UPDATE SET
  status      = 'issued',
  issued_to   = 'legacy-user',
  issued_at   = COALESCE(access_codes.issued_at, NOW()),
  expires_at  = NULL,
  note        = '手动发放 · legacy 永久权限';

INSERT INTO users (code, status, tier, tier_expires_at, created_at, last_login)
VALUES ('XXY123', 'active', 'legacy', NULL, NOW(), NOW())
ON CONFLICT (code) DO UPDATE SET
  status          = 'active',
  tier            = 'legacy',
  tier_expires_at = NULL;

-- 核对结果（跑完应看到 status=issued / tier=legacy / tier_expires_at 为空）
SELECT a.code, a.status AS code_status, a.issued_to, a.expires_at AS code_expires_at,
       u.status AS user_status, u.tier, u.tier_expires_at
FROM access_codes a
LEFT JOIN users u ON u.code = a.code
WHERE a.code = 'XXY123';
