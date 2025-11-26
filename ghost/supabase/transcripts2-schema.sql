-- ============================================================================
-- GHOST-NEXT: transcripts2 — PRODUCTION SCHEMA (VERBATIM)
-- ============================================================================
-- This is the REAL table in Supabase production.
-- NO separate transcript_chunks table — chunks stored in transcript_chunk jsonb[]
-- ============================================================================

-- PRODUCTION SCHEMA — DO NOT MODIFY WITHOUT MIGRATION PLAN
CREATE TABLE IF NOT EXISTS public.transcripts2 (
  -- Primary key
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- User/Provider identification
  user_id UUID NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ,
  queued_completed_at TIMESTAMPTZ,

  -- Unique message ID
  mid UUID DEFAULT gen_random_uuid() UNIQUE,

  -- AI Processing outputs
  ai_summary JSONB,
  ai_short_summary JSONB,
  ai_interim_summaries JSONB[],

  -- Token metrics
  token_count INT4,

  -- Full transcript text (flattened)
  transcript TEXT,

  -- Diarized chunks array (THIS IS WHERE CHUNKS GO)
  transcript_chunk JSONB[],

  -- Patient identification
  patient_tag INT DEFAULT 0,
  patient_code TEXT DEFAULT '',     -- AssistMD internal encounter ID
  patient_uuid UUID,                -- Links to EMR patient

  -- Processing state
  current_audio_segment INT,
  is_paused BOOL,

  -- Error tracking
  error TEXT,

  -- Localization
  language TEXT,

  -- PII handling
  pii_mapping BYTEA
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_transcripts2_user_id
  ON public.transcripts2(user_id);

CREATE INDEX IF NOT EXISTS idx_transcripts2_created_at
  ON public.transcripts2(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcripts2_mid
  ON public.transcripts2(mid);

CREATE INDEX IF NOT EXISTS idx_transcripts2_patient_uuid
  ON public.transcripts2(patient_uuid)
  WHERE patient_uuid IS NOT NULL;

-- ============================================================================
-- Key Schema Insights
-- ============================================================================
--
-- 1. transcript_chunk jsonb[] stores diarized chunks (NOT a separate table)
--
-- 2. patient_code = AssistMD internal encounter ID
--    patient_uuid = Links to EMR patient record
--
-- 3. No "sessions" table exists
--    No "transcripts" table exists
--    EVERYTHING goes into transcripts2
--
-- 4. ai_interim_summaries jsonb[] = incremental AI summaries during recording
--
-- 5. transcript = full flattened text (for search, display)
--
-- ============================================================================

-- ============================================================================
-- Chunk Object Structure (stored in transcript_chunk jsonb[])
-- ============================================================================
/*
Each chunk in the transcript_chunk array:
{
  "speaker": <number>,           -- Deepgram speaker ID (0-49)
  "text": "joined tokens",       -- Aggregated text
  "start": <float>,              -- Start time (seconds)
  "end": <float>,                -- End time (seconds)
  "word_count": <int>,           -- Number of words
  "raw": [                       -- Original Deepgram words
    {
      "word": "hello",
      "start": 0.0,
      "end": 0.3,
      "confidence": 0.98,
      "speaker": 0
    }
  ]
}

Chunk aggregation rules:
- Start new chunk when:
  • speaker changes OR
  • (current_word.end - chunk.start) > 30 seconds
*/

-- ============================================================================
-- Sample Insert (for reference)
-- ============================================================================
/*
INSERT INTO public.transcripts2 (
  user_id,
  patient_code,
  patient_uuid,
  language,
  transcript_chunk,
  ai_interim_summaries
) VALUES (
  'user-uuid-here',
  'encounter-123',
  'patient-uuid-here',
  'en',
  ARRAY[]::jsonb[],
  ARRAY[]::jsonb[]
);
*/
