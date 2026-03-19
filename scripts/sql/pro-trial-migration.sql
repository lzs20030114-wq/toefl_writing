-- Migration: Auto-grant 3-day Pro trial to new users
-- Run this in your Supabase SQL editor

-- Step 1: Add pro_trial column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_trial BOOLEAN DEFAULT false;

-- Step 2: Backfill recently registered free-tier users (last 7 days)
-- These users get a 3-day Pro trial starting NOW
-- Adjust the interval ('7 days') if needed
UPDATE users
SET tier = 'pro',
    tier_expires_at = (NOW() + INTERVAL '3 days'),
    pro_trial = true
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND tier = 'free'
  AND pro_trial = false;
