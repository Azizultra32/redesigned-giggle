# Supabase Schema Reference

## transcripts2 Table

The primary table for storing transcript sessions and diarized content.

### Schema

```sql
CREATE TABLE IF NOT EXISTS public.transcripts2 (
  -- Primary key: auto-incrementing BIGINT
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- User who created the transcript
  user_id UUID NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ,
  queued_completed_at TIMESTAMPTZ,

  -- Message ID for deduplication
  mid UUID DEFAULT gen_random_uuid() UNIQUE,

  -- AI processing results
  ai_summary JSONB,
  ai_short_summary JSONB,
  ai_interim_summaries JSONB[],
  token_count INT4,

  -- Transcript content
  transcript TEXT,                    -- Full flattened text
  transcript_chunk JSONB[],           -- Diarized chunks array

  -- Patient info
  patient_tag INT DEFAULT 0,
  patient_code TEXT DEFAULT '',       -- AssistMD encounter ID
  patient_uuid UUID,                  -- EMR patient reference

  -- State tracking
  current_audio_segment INT,
  is_paused BOOL,
  error TEXT,

  -- Metadata
  language TEXT,
  pii_mapping BYTEA                   -- Encrypted PII map
);
```

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_transcripts2_user_id
  ON public.transcripts2(user_id);

CREATE INDEX IF NOT EXISTS idx_transcripts2_created_at
  ON public.transcripts2(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcripts2_mid
  ON public.transcripts2(mid);

CREATE INDEX IF NOT EXISTS idx_transcripts2_patient_uuid
  ON public.transcripts2(patient_uuid)
  WHERE patient_uuid IS NOT NULL;
```

## Chunk Format

Each element in `transcript_chunk` JSONB array:

```typescript
interface TranscriptChunk {
  speaker: number;      // 0 = Provider, 1+ = Patient
  text: string;         // Punctuated transcript text
  start: number;        // Start time in seconds
  end: number;          // End time in seconds
  word_count: number;   // Number of words
  raw: WordResult[];    // Original Deepgram words
}

interface WordResult {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: number;
}
```

### Example Chunk

```json
{
  "speaker": 0,
  "text": "Hello, how are you feeling today?",
  "start": 0.0,
  "end": 2.5,
  "word_count": 6,
  "raw": [
    { "word": "Hello", "start": 0.0, "end": 0.4, "confidence": 0.99, "speaker": 0 },
    { "word": "how", "start": 0.5, "end": 0.7, "confidence": 0.98, "speaker": 0 },
    { "word": "are", "start": 0.8, "end": 0.9, "confidence": 0.97, "speaker": 0 },
    { "word": "you", "start": 1.0, "end": 1.2, "confidence": 0.99, "speaker": 0 },
    { "word": "feeling", "start": 1.3, "end": 1.8, "confidence": 0.96, "speaker": 0 },
    { "word": "today", "start": 1.9, "end": 2.4, "confidence": 0.98, "speaker": 0 }
  ]
}
```

## Row Level Security

```sql
-- Enable RLS
ALTER TABLE transcripts2 ENABLE ROW LEVEL SECURITY;

-- Users can only access their own transcripts
CREATE POLICY user_access ON public.transcripts2
  FOR ALL
  USING (user_id = auth.uid());

-- Service role bypasses RLS (for backend)
```

## Common Queries

### Create Transcript Run

```typescript
const { data } = await supabase
  .from('transcripts2')
  .insert({
    user_id: userId,
    patient_code: patientCode || '',
    language: 'en',
    transcript_chunk: [],
    ai_interim_summaries: []
  })
  .select('id')
  .single();
```

### Save Chunks (Append)

```typescript
// 1. Fetch existing
const { data: existing } = await supabase
  .from('transcripts2')
  .select('transcript_chunk')
  .eq('id', transcriptId)
  .single();

// 2. Append and update
const updatedChunks = [...existing.transcript_chunk, ...newChunks];
const fullText = updatedChunks.map(c => `[Speaker ${c.speaker}]: ${c.text}`).join('\n');

await supabase
  .from('transcripts2')
  .update({
    transcript_chunk: updatedChunks,
    transcript: fullText
  })
  .eq('id', transcriptId);
```

### Complete Transcript

```typescript
await supabase
  .from('transcripts2')
  .update({ completed_at: new Date().toISOString() })
  .eq('id', transcriptId);
```

### Get Full Transcript

```typescript
const { data } = await supabase
  .from('transcripts2')
  .select('transcript, transcript_chunk')
  .eq('id', transcriptId)
  .single();
```

## Key Points

1. **NO separate chunks table** - All chunks in `transcript_chunk` JSONB array
2. **BIGINT id** - Not UUID
3. **user_id** - Not provider_id
4. **patient_code** - AssistMD encounter ID (e.g., "ENC-2024-00001")
5. **Service role key** required for backend (bypasses RLS)
