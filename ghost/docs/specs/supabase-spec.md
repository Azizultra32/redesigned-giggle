# Supabase Specification

## Overview

Supabase serves as the persistence layer for transcript data using the `transcripts2` table.

## Connection

### Client Initialization

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
```

### Service Role vs Anon Key

| Key Type | Use Case | RLS |
|----------|----------|-----|
| Service Role | Backend server | Bypasses |
| Anon Key | Client apps | Enforced |

**CRITICAL:** Backend uses `service_role` key to bypass RLS.

## Schema

### transcripts2 Table

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

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| id | BIGINT | Auto-generated primary key |
| user_id | UUID | Clinician identifier |
| transcript | TEXT | Full flattened text |
| transcript_chunk | JSONB[] | Diarized chunks array |
| patient_code | TEXT | AssistMD encounter ID |
| patient_uuid | UUID | EMR patient reference |
| completed_at | TIMESTAMPTZ | When session ended |

## Operations

### Create Transcript Run

```typescript
async function createTranscriptRun(
  userId: string,
  patientCode?: string,
  patientUuid?: string
): Promise<number> {
  const { data, error } = await supabase
    .from('transcripts2')
    .insert({
      user_id: userId,
      patient_code: patientCode || '',
      patient_uuid: patientUuid || null,
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

### Save Transcript Chunks

```typescript
async function saveTranscriptChunks(
  transcriptId: number,
  chunks: TranscriptChunk[]
): Promise<void> {
  // 1. Fetch existing chunks
  const { data: existing } = await supabase
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', transcriptId)
    .single();

  // 2. Append new chunks
  const updatedChunks = [...(existing?.transcript_chunk || []), ...chunks];

  // 3. Rebuild full transcript text
  const fullText = updatedChunks
    .map(c => `[Speaker ${c.speaker}]: ${c.text}`)
    .join('\n');

  // 4. Update record
  await supabase
    .from('transcripts2')
    .update({
      transcript_chunk: updatedChunks,
      transcript: fullText
    })
    .eq('id', transcriptId);
}
```

### Complete Transcript

```typescript
async function updateTranscriptRun(transcriptId: number): Promise<void> {
  await supabase
    .from('transcripts2')
    .update({
      completed_at: new Date().toISOString()
    })
    .eq('id', transcriptId);
}
```

### Update Patient Info

```typescript
async function updatePatientInfo(
  transcriptId: number,
  patientCode: string,
  patientUuid?: string
): Promise<void> {
  await supabase
    .from('transcripts2')
    .update({
      patient_code: patientCode,
      patient_uuid: patientUuid || null
    })
    .eq('id', transcriptId);
}
```

### Query Transcript

```typescript
async function getFullTranscript(transcriptId: number): Promise<string> {
  const { data } = await supabase
    .from('transcripts2')
    .select('transcript')
    .eq('id', transcriptId)
    .single();

  return data?.transcript || '';
}

async function getChunks(transcriptId: number): Promise<TranscriptChunk[]> {
  const { data } = await supabase
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', transcriptId)
    .single();

  return data?.transcript_chunk || [];
}
```

## Row Level Security

```sql
ALTER TABLE transcripts2 ENABLE ROW LEVEL SECURITY;

-- Users can only access their own transcripts
CREATE POLICY user_access ON public.transcripts2
  FOR ALL
  USING (user_id = auth.uid());
```

Service role key bypasses RLS.

## Error Handling

```typescript
try {
  await supabase.from('transcripts2').insert({...});
} catch (error) {
  if (error.code === '23505') {
    // Unique violation (e.g., duplicate mid)
  } else if (error.code === '23503') {
    // Foreign key violation
  } else {
    // Other database error
  }
}
```

## Performance Considerations

### Indexes

```sql
CREATE INDEX idx_transcripts2_user_id ON transcripts2(user_id);
CREATE INDEX idx_transcripts2_created_at ON transcripts2(created_at DESC);
CREATE INDEX idx_transcripts2_mid ON transcripts2(mid);
```

### Query Optimization

1. **Select specific columns** - Don't `select('*')`
2. **Use indexes** - Filter by indexed columns
3. **Limit results** - Use `.limit()` for lists
4. **Batch updates** - Group chunk saves

## Migration Notes

### From Legacy Schema

If migrating from a schema with separate `transcript_chunks` table:

1. Chunks now stored in `transcript_chunk JSONB[]`
2. No foreign key relationship
3. Append-only during recording
4. Rebuild transcript text on each save
