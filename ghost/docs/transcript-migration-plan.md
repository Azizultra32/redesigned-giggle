# Transcript Migration Plan

## Overview

This document outlines the migration strategy from legacy transcript storage to the new `transcripts2` + `transcript_chunks` schema.

---

## Schema Comparison

### Old Schema (Legacy)
```sql
transcripts (
  id,
  content,        -- Full text blob
  provider_id,
  created_at
)
```

### New Schema (transcripts2)
```sql
transcripts2 (
  id UUID,
  provider_id TEXT,
  patient_code TEXT,
  patient_uuid UUID,
  status TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  metadata JSONB
)

transcript_chunks (
  id UUID,
  transcript_id UUID FK,
  chunk_index INTEGER,
  speaker TEXT,
  text TEXT,
  start_time FLOAT,
  end_time FLOAT,
  confidence FLOAT,
  words JSONB
)
```

---

## Migration Steps

### Phase 1: Schema Creation

1. Create new tables (don't drop old yet):
```sql
-- Run transcripts2-schema.sql
-- Run transcript-chunks.sql
```

2. Verify tables exist:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('transcripts2', 'transcript_chunks');
```

### Phase 2: Data Migration

For each legacy transcript:

1. Create entry in `transcripts2`:
```sql
INSERT INTO transcripts2 (provider_id, status, started_at, metadata)
SELECT
  provider_id,
  'completed',
  created_at,
  jsonb_build_object('migrated_from', 'legacy', 'original_id', id::text)
FROM transcripts
WHERE id = :old_id
RETURNING id;
```

2. Parse content into chunks:
```typescript
// If content has speaker annotations like "[Provider]: text"
const lines = content.split('\n');
let chunkIndex = 0;

for (const line of lines) {
  const match = line.match(/\[(\w+)\]:\s*(.+)/);
  if (match) {
    await supabase.from('transcript_chunks').insert({
      transcript_id: newId,
      chunk_index: chunkIndex++,
      speaker: match[1] === 'Provider' ? '0' : '1',
      text: match[2],
      is_final: true
    });
  }
}
```

3. If no speaker annotations, create single chunk:
```sql
INSERT INTO transcript_chunks (transcript_id, chunk_index, speaker, text)
VALUES (:new_id, 0, '0', :full_content);
```

### Phase 3: Validation

1. Count records:
```sql
SELECT
  (SELECT COUNT(*) FROM transcripts) as old_count,
  (SELECT COUNT(*) FROM transcripts2) as new_count;
-- Should match
```

2. Spot check content:
```sql
SELECT
  t2.id,
  STRING_AGG(c.text, ' ' ORDER BY c.chunk_index) as reconstructed
FROM transcripts2 t2
JOIN transcript_chunks c ON c.transcript_id = t2.id
GROUP BY t2.id
LIMIT 5;
-- Compare with original content
```

### Phase 4: Cutover

1. Update application code to use new tables
2. Deploy updated backend
3. Verify new recordings go to transcripts2
4. Keep legacy table for rollback (30 days)

### Phase 5: Cleanup

After 30 days stable:
```sql
-- Backup first!
pg_dump -t transcripts > transcripts_backup.sql

-- Then drop
DROP TABLE transcripts;
```

---

## Rollback Plan

If issues arise:

1. Revert backend code to use legacy table
2. Deploy reverted code
3. New recordings go to old table
4. Investigate issues with new schema

---

## Migration Script Template

```typescript
// migrate-transcripts.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function migrate() {
  // 1. Get all legacy transcripts
  const { data: legacy } = await supabase
    .from('transcripts')
    .select('*');

  for (const old of legacy || []) {
    // 2. Create new transcript2 entry
    const { data: newT } = await supabase
      .from('transcripts2')
      .insert({
        provider_id: old.provider_id,
        status: 'completed',
        started_at: old.created_at,
        metadata: { migrated: true, legacy_id: old.id }
      })
      .select('id')
      .single();

    // 3. Parse and create chunks
    const chunks = parseContent(old.content);
    await supabase
      .from('transcript_chunks')
      .insert(chunks.map((c, i) => ({
        transcript_id: newT!.id,
        chunk_index: i,
        speaker: c.speaker,
        text: c.text,
        is_final: true
      })));

    console.log(`Migrated ${old.id} → ${newT!.id}`);
  }
}

function parseContent(content: string) {
  // Parse speaker annotations or return single chunk
  const lines = content.split('\n').filter(l => l.trim());
  const chunks: { speaker: string; text: string }[] = [];

  for (const line of lines) {
    const match = line.match(/\[(\w+)\]:\s*(.+)/);
    if (match) {
      chunks.push({
        speaker: match[1].toLowerCase() === 'provider' ? '0' : '1',
        text: match[2]
      });
    }
  }

  // If no annotations found, single chunk
  if (chunks.length === 0) {
    chunks.push({ speaker: '0', text: content });
  }

  return chunks;
}

migrate();
```

---

## Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Schema Creation | 1 day | Not Started |
| Data Migration | 2-3 days | Not Started |
| Validation | 1 day | Not Started |
| Cutover | 1 day | Not Started |
| Cleanup | After 30 days | Not Started |

---

## Checklist

- [ ] Schema SQL files ready
- [ ] Migration script tested on dev
- [ ] Backup of legacy data
- [ ] Rollback procedure documented
- [ ] Application code updated
- [ ] Validation queries ready
- [ ] Stakeholders notified
