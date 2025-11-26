-- ============================================
-- Consent Events Table (PATH E - Feed E)
-- ============================================
-- Records patient consent voice commands
-- Linked to transcript_runs for audit trail

CREATE TABLE IF NOT EXISTS consent_events (
  id BIGSERIAL PRIMARY KEY,
  transcript_id BIGINT NOT NULL REFERENCES transcripts2(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Optional metadata
  speaker_id INTEGER,
  confidence REAL,
  audio_offset_ms INTEGER
);

-- Index for fast lookup by transcript
CREATE INDEX IF NOT EXISTS idx_consent_events_transcript
  ON consent_events(transcript_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_consent_events_timestamp
  ON consent_events(timestamp DESC);

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE consent_events ENABLE ROW LEVEL SECURITY;

-- Users can only see consent events for their own transcripts
CREATE POLICY "Users can view own consent events" ON consent_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM transcripts2
      WHERE transcripts2.id = consent_events.transcript_id
      AND transcripts2.user_id = auth.uid()::text
    )
  );

-- Users can insert consent events for their own transcripts
CREATE POLICY "Users can insert own consent events" ON consent_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transcripts2
      WHERE transcripts2.id = consent_events.transcript_id
      AND transcripts2.user_id = auth.uid()::text
    )
  );

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE consent_events IS 'Stores patient consent voice commands captured during transcription';
COMMENT ON COLUMN consent_events.phrase IS 'The exact phrase detected (e.g., "Assist, consent granted")';
COMMENT ON COLUMN consent_events.timestamp IS 'When the consent was spoken during the recording';
COMMENT ON COLUMN consent_events.speaker_id IS 'Diarization speaker ID (0=doctor, 1=patient typically)';
