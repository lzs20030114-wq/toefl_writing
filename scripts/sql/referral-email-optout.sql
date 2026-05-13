-- Adds an opt-out column so users can disable referral activity emails
-- without losing other transactional mail (OTP, password reset, etc.).
--
-- Run in Supabase SQL Editor.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_optout_referral BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
