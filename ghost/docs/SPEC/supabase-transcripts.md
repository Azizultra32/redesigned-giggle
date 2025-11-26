# Supabase Transcripts Specification

## Overview

This spec defines the **PRODUCTION** schema for transcript storage in Supabase.

**CRITICAL:** There is NO separate `transcript_chunks` table. Chunks are stored in the `transcript_chunk jsonb[]` array within `transcripts2`.

---

## Table: `public.transcripts2` (PRODUCTION SCHEMA)

```sql
CREATE TABLE public.transcripts2 (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ,
  queued_completed_at TIMESTAMPTZ,
  mid UUID DEFAULT gen_random_uuid() UNIQUE,
  ai_summary JSONB,
  ai_short_summary JSONB,
  ai_interim_summaries JSONB[],
  token_count INT4,
  transcript TEXT,
  transcript_chunk JSONB[],
  patient_tag INT DEFAULT 0,
  patient_code TEXT DEFAULT '',
  patient_uuid UUID,
  current_audio_segment INT,
  is_paused BOOL,
  error TEXT,
  language TEXT,
  pii_mapping BYTEA
);
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `id` | BIGINT | Primary key, auto-increment |
| `user_id` | UUID | Provider/clinician UUID (required) |
| `created_at` | TIMESTAMPTZ | Record creation time |
| `completed_at` | TIMESTAMPTZ | When recording completed |
| `processed_at` | TIMESTAMPTZ | When AI processing completed |
| `queued_at` | TIMESTAMPTZ | When queued for processing |
| `mid` | UUID | Unique message ID |
| `ai_summary` | JSONB | Final AI summary |
| `ai_short_summary` | JSONB | Abbreviated summary |
| `ai_interim_summaries` | JSONB[] | Incremental summaries during recording |
| `token_count` | INT4 | Token count for AI processing |
| `transcript` | TEXT | Full flattened transcript text |
| `transcript_chunk` | JSONB[] | **Diarized chunks array** |
| `patient_tag` | INT | Patient classification tag |
| `patient_code` | TEXT | AssistMD internal encounter ID |
| `patient_uuid` | UUID | EMR patient record UUID |
| `current_audio_segment` | INT | Current audio segment being processed |
| `is_paused` | BOOL | Recording paused state |
| `error` | TEXT | Error message if failed |
| `language` | TEXT | Language code (e.g., 'en') |
| `pii_mapping` | BYTEA | PII mapping data (encrypted) |

---

## Key Schema Insights

1. **NO separate chunks table** — `transcript_chunk jsonb[]` stores all diarized chunks
2. **`patient_code`** = AssistMD internal encounter ID
3. **`patient_uuid`** = Links to EMR patient record
4. **NO `sessions` table exists**
5. **NO `transcripts` table exists**
6. **EVERYTHING goes into `transcripts2`**

---

## Chunk Object Structure

Each element in `transcript_chunk jsonb[]`:

```json
{
  "speaker": 0,
  "text": "Good morning. How are you feeling today?",
  "start": 0.0,
  "end": 2.5,
  "word_count": 7,
  "raw": [
    {
      "word": "Good",
      "start": 0.0,
      "end": 0.3,
      "confidence": 0.99,
      "speaker": 0
    },
    {
      "word": "morning",
      "start": 0.35,
      "end": 0.8,
      "confidence": 0.98,
      "speaker": 0
    }
  ]
}
```

### Chunk Fields

| Field | Type | Description |
|-------|------|-------------|
| `speaker` | number | Deepgram speaker ID (0-49) |
| `text` | string | Aggregated text for this chunk |
| `start` | float | Start time in seconds |
| `end` | float | End time in seconds |
| `word_count` | int | Number of words |
| `raw` | array | Original Deepgram word objects |

---

## Query Patterns

### Create Transcript Run

```typescript
async function createTranscriptRun(userId: string, patientCode?: string): Promise<number> {
  const { data, error } = await supabase
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

  if (error) throw error;
  return data.id;
}
```

### Save Transcript Chunks (Append)

```typescript
async function saveTranscriptChunks(id: number, chunks: Chunk[]): Promise<void> {
  // Get existing chunks
  const { data: existing } = await supabase
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', id)
    .single();

  // Append new chunks
  const updatedChunks = [...(existing?.transcript_chunk || []), ...chunks];

  // Build full transcript text
  const fullTranscript = updatedChunks
    .map(c => `[Speaker ${c.speaker}]: ${c.text}`)
    .join('\n');

  const { error } = await supabase
    .from('transcripts2')
    .update({
      transcript_chunk: updatedChunks,
      transcript: fullTranscript
    })
    .eq('id', id);

  if (error) throw error;
}
```

### Update Transcript Run (Complete)

```typescript
async function updateTranscriptRun(id: number): Promise<void> {
  const { error } = await supabase
    .from('transcripts2')
    .update({
      completed_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
}
```

### Get Full Transcript

```typescript
async function getFullTranscript(id: number): Promise<string> {
  const { data, error } = await supabase
    .from('transcripts2')
    .select('transcript')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data.transcript || '';
}
```

---

## Code Contracts

### TranscriptRun creation MUST include:
- `user_id` (required)
- `patient_code` (can be empty string)
- `patient_uuid` (if known)
- `language`
- `transcript_chunk = []`
- `ai_interim_summaries = []`

### Chunk save MUST:
- Append to `transcript_chunk` array
- Update `transcript` text string
- Update `completed_at` when final

### Overlay MUST:
- Display real-time diarized transcript
- Resolve `patient_uuid` when DOM analysis succeeds
- Attach patient metadata to backend

---

## RLS Policies

```sql
ALTER TABLE public.transcripts2 ENABLE ROW LEVEL SECURITY;

-- Users can only access their own transcripts
CREATE POLICY transcripts2_user_select ON public.transcripts2
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY transcripts2_user_insert ON public.transcripts2
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY transcripts2_user_update ON public.transcripts2
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY transcripts2_user_delete ON public.transcripts2
  FOR DELETE USING (user_id = auth.uid());
```

**Note:** Backend uses `service_role` key which bypasses RLS.
