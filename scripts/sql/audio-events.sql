-- Exam audio playback health — captures the unlock → play lifecycle of the
-- persistent exam audio player so we can quantify how often mobile browsers
-- (iOS Safari / WeChat / QQ) block autoplay, how the recovery overlay
-- performs, and first-frame latency per clip.
--
-- Written by app/api/analytics/audio/route.js (service role). The route is
-- deployable BEFORE this migration runs — inserts fail silently until then.
--
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS audio_events (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL CHECK (event IN (
    'unlock_ok',        -- silent-WAV unlock succeeded inside the start gesture
    'unlock_blocked',   -- even the in-gesture unlock was rejected
    'play_blocked',     -- play() rejected with NotAllowedError mid-exam
    'play_ok',          -- 'playing' fired (first_frame_ms = play()→playing)
    'play_error',       -- media error (bad file / network / decode)
    'stall_timeout',    -- watchdog gave up waiting for 'playing'
    'tts_fallback',     -- clip failed, rescued via Web Speech
    'overlay_shown',    -- recovery overlay displayed
    'overlay_resume',   -- user tapped 继续考试 on the overlay
    'interrupted'       -- playback cut by tab switch / phone call
  )),
  section TEXT NULL,            -- 'listening' | 'speaking'
  task_type TEXT NULL,          -- 'lcr' | 'la' | 'lc' | 'lat' | 'repeat' | 'interview'
  item_id TEXT NULL,
  audio_path TEXT NULL,
  error_name TEXT NULL,         -- DOMException name
  media_error_code INT NULL,    -- HTMLMediaElement.error.code
  ready_state INT NULL,
  network_state INT NULL,
  first_frame_ms INT NULL,      -- play() → 'playing' latency (play_ok only)
  reason TEXT NULL,             -- 'not-allowed' | 'silent-timeout' | 'interrupted'
  user_agent TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audio_events_event      ON audio_events(event);
CREATE INDEX IF NOT EXISTS idx_audio_events_created_at ON audio_events(created_at DESC);

-- RLS: block direct public access (only the service role writes via the API)
ALTER TABLE audio_events ENABLE ROW LEVEL SECURITY;
-- No public policies = public can't read/write directly

-- Force PostgREST to refresh its schema cache so /api/analytics/audio can
-- write to the new table immediately after migration.
NOTIFY pgrst, 'reload schema';
