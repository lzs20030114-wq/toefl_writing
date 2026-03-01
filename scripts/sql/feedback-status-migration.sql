-- Migration: add status and admin_reply to user_feedback
-- Run once in Supabase SQL editor

ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS admin_reply TEXT;

-- status values: 'new' | 'resolved'
