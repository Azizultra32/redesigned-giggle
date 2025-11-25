# Supabase Notes

## Project Configuration

### Required Environment Variables

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your_service_role_key
```

**IMPORTANT:** Use `service_role` key for backend, NEVER `anon` key.

---

## Schema Setup

Run these SQL commands in Supabase SQL Editor:

### 1. Create transcripts2 Table

```sql
CREATE TABLE IF NOT EXISTS transcripts2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  patient_code TEXT,
  patient_uuid UUID,
  status TEXT NOT NULL DEFAULT 'recording',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts2_provider ON transcripts2(provider_id);
CREATE INDEX IF NOT EXISTS idx_transcripts2_status ON transcripts2(status);
CREATE INDEX IF NOT EXISTS idx_transcripts2_started ON transcripts2(started_at DESC);
```

### 2. Create transcript_chunks Table

```sql
CREATE TABLE IF NOT EXISTS transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES transcripts2(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  start_time FLOAT,
  end_time FLOAT,
  confidence FLOAT,
  words JSONB,
  is_final BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_transcript ON transcript_chunks(transcript_id);
CREATE INDEX IF NOT EXISTS idx_chunks_order ON transcript_chunks(transcript_id, chunk_index);
```

### 3. Enable RLS (Optional for Development)

```sql
-- Enable RLS
ALTER TABLE transcripts2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_chunks ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY service_full_access ON transcripts2
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY chunks_service_access ON transcript_chunks
  FOR ALL USING (true) WITH CHECK (true);
```

---

## Common Queries

### Get Recent Transcripts

```sql
SELECT id, provider_id, status, started_at
FROM transcripts2
ORDER BY started_at DESC
LIMIT 10;
```

### Get Full Transcript Text

```sql
SELECT
  t.id,
  t.started_at,
  STRING_AGG(
    '[' || c.speaker || ']: ' || c.text,
    E'\n' ORDER BY c.chunk_index
  ) as full_text
FROM transcripts2 t
LEFT JOIN transcript_chunks c ON c.transcript_id = t.id
WHERE t.id = 'your-uuid-here'
GROUP BY t.id, t.started_at;
```

### Count Chunks by Speaker

```sql
SELECT
  speaker,
  COUNT(*) as chunk_count,
  SUM(LENGTH(text)) as total_chars
FROM transcript_chunks
WHERE transcript_id = 'your-uuid-here'
GROUP BY speaker;
```

### Delete Test Data

```sql
-- Delete all test transcripts
DELETE FROM transcripts2 WHERE provider_id = 'test';

-- Or delete by date
DELETE FROM transcripts2 WHERE started_at < NOW() - INTERVAL '7 days';
```

---

## Offline Mode

If Supabase credentials are not configured, the backend runs in offline mode:

- All features work except persistence
- Data is not saved between sessions
- Useful for development and testing

To enable offline mode, simply don't set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

---

## Performance Tips

1. **Index Usage**: Queries filter by `provider_id` and `transcript_id` - both indexed
2. **Batch Inserts**: Insert multiple chunks in one call when possible
3. **JSONB Indexing**: If querying words frequently, add GIN index:
   ```sql
   CREATE INDEX idx_chunks_words ON transcript_chunks USING GIN (words);
   ```

---

## Backup & Export

### Export Transcript to JSON

```sql
SELECT json_build_object(
  'transcript', t.*,
  'chunks', (
    SELECT json_agg(c.* ORDER BY c.chunk_index)
    FROM transcript_chunks c
    WHERE c.transcript_id = t.id
  )
)
FROM transcripts2 t
WHERE t.id = 'your-uuid-here';
```

### Export All Transcripts

```bash
# Using Supabase CLI
supabase db dump --data-only > backup.sql
```
