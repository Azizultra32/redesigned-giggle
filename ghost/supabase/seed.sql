-- ============================================================================
-- GHOST-NEXT: Seed Data for Development
-- ============================================================================
-- Sample data matching the PRODUCTION transcripts2 schema
-- ============================================================================

-- Sample completed transcript with diarized chunks
INSERT INTO public.transcripts2 (
  user_id,
  patient_code,
  patient_uuid,
  language,
  transcript,
  transcript_chunk,
  ai_interim_summaries,
  completed_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',  -- dev user_id
  'ENC-2024-001',                           -- AssistMD encounter ID
  '00000000-0000-0000-0000-000000000002',  -- patient UUID
  'en',
  '[Speaker 0]: Good morning. How are you feeling today?
[Speaker 1]: I have been having headaches more frequently, maybe three times a week now.
[Speaker 0]: I see. When did these headaches start?
[Speaker 1]: About two weeks ago. The pain is mostly in my temples.',
  ARRAY[
    '{"speaker": 0, "text": "Good morning. How are you feeling today?", "start": 0.0, "end": 2.5, "word_count": 7, "raw": []}'::jsonb,
    '{"speaker": 1, "text": "I have been having headaches more frequently, maybe three times a week now.", "start": 3.0, "end": 7.5, "word_count": 13, "raw": []}'::jsonb,
    '{"speaker": 0, "text": "I see. When did these headaches start?", "start": 8.0, "end": 10.5, "word_count": 7, "raw": []}'::jsonb,
    '{"speaker": 1, "text": "About two weeks ago. The pain is mostly in my temples.", "start": 11.0, "end": 15.0, "word_count": 11, "raw": []}'::jsonb
  ],
  ARRAY[]::jsonb[],
  NOW() - INTERVAL '45 minutes'
) ON CONFLICT DO NOTHING;

-- Sample in-progress transcript (recording)
INSERT INTO public.transcripts2 (
  user_id,
  patient_code,
  language,
  transcript_chunk,
  ai_interim_summaries
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'ENC-2024-002',
  'en',
  ARRAY[]::jsonb[],
  ARRAY[]::jsonb[]
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- Verification Queries
-- ============================================================================
/*
-- Check data was inserted
SELECT id, patient_code, language, completed_at
FROM public.transcripts2;

-- View chunks for first transcript
SELECT
  id,
  jsonb_array_length(transcript_chunk) as chunk_count,
  transcript_chunk
FROM public.transcripts2
WHERE patient_code = 'ENC-2024-001';

-- Reconstruct transcript from chunks
SELECT
  id,
  (
    SELECT string_agg(
      '[Speaker ' || (chunk->>'speaker') || ']: ' || (chunk->>'text'),
      E'\n' ORDER BY ordinality
    )
    FROM unnest(transcript_chunk) WITH ORDINALITY AS t(chunk, ordinality)
  ) as reconstructed
FROM public.transcripts2
WHERE patient_code = 'ENC-2024-001';
*/
