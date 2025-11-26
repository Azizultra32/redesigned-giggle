# Supabase Error Troubleshooting

## Common Errors

### 42P01 - Relation Does Not Exist

**Error Message:**
```
PostgresError: relation "transcripts2" does not exist
Code: 42P01
```

**Causes:**
1. Table not created yet
2. Wrong schema/database
3. Typo in table name

**Solutions:**

1. Create the table:
```sql
-- Run in Supabase SQL Editor
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
```

2. Verify table exists:
```sql
SELECT * FROM information_schema.tables
WHERE table_name = 'transcripts2';
```

3. Check you're on right project:
   - Verify SUPABASE_URL in .env
   - Compare with dashboard URL

---

### 42501 - RLS Policy Violation

**Error Message:**
```
PostgresError: new row violates row-level security policy
Code: 42501
```

**Causes:**
1. RLS enabled but no policy allows access
2. Using anon key instead of service_role
3. Policy condition not met

**Solutions:**

1. Use service_role key (backend only):
```bash
# In backend/.env - use SERVICE_ROLE key, not anon
SUPABASE_SERVICE_ROLE_KEY=eyJ...service_role_key
```

2. Check RLS policies:
```sql
SELECT * FROM pg_policies WHERE tablename = 'transcripts2';
```

3. Temporarily disable RLS (testing only):
```sql
ALTER TABLE transcripts2 DISABLE ROW LEVEL SECURITY;
-- Re-enable after testing!
ALTER TABLE transcripts2 ENABLE ROW LEVEL SECURITY;
```

4. Add policy for service role:
```sql
-- Service role bypasses RLS by default
-- But if you need explicit policy:
CREATE POLICY service_access ON transcripts2
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

---

### 23503 - Foreign Key Violation

**Error Message:**
```
PostgresError: insert or update violates foreign key constraint
Code: 23503
```

**Causes:**
1. Referenced record doesn't exist
2. Wrong UUID format
3. Cascade not configured

**Solutions:**

1. Check parent record exists:
```sql
SELECT id FROM transcripts2 WHERE id = 'your-uuid-here';
```

2. Verify UUID format:
```typescript
// Valid UUID format
const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
```

3. Insert parent first, then child:
```typescript
// 1. Create transcript
const { data: transcript } = await supabase
  .from('transcripts2')
  .insert({ provider_id: 'test' })
  .select('id')
  .single();

// 2. Then insert chunks
await supabase
  .from('transcript_chunks')
  .insert({
    transcript_id: transcript.id,  // Use actual ID
    // ...
  });
```

---

### PGRST301 - JWT Expired

**Error Message:**
```
{"message":"JWT expired","code":"PGRST301"}
```

**Causes:**
1. Token expired
2. Clock skew between client/server

**Solutions:**

1. Service role key doesn't expire - verify you're using it:
```bash
# Check key type (service_role vs anon)
echo $SUPABASE_SERVICE_ROLE_KEY | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .role
# Should output: "service_role"
```

2. For anon key, refresh token:
```typescript
const { data, error } = await supabase.auth.refreshSession();
```

---

### Network/Connection Errors

**Error Message:**
```
FetchError: request to https://xxx.supabase.co failed
```

**Causes:**
1. Wrong SUPABASE_URL
2. Network issues
3. Project paused

**Solutions:**

1. Verify URL format:
```bash
# Should be: https://your-project-id.supabase.co
echo $SUPABASE_URL
```

2. Test connectivity:
```bash
curl -I $SUPABASE_URL/rest/v1/
# Should return 200 or 401 (auth required)
```

3. Check project status:
   - Go to Supabase dashboard
   - Ensure project is not paused
   - Free tier pauses after inactivity

---

### 22P02 - Invalid Text Representation

**Error Message:**
```
PostgresError: invalid input syntax for type uuid
Code: 22P02
```

**Causes:**
1. Invalid UUID string
2. Passing wrong data type

**Solutions:**

1. Validate UUID before insert:
```typescript
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}
```

2. Use gen_random_uuid() for new records:
```sql
-- Let Postgres generate UUID
INSERT INTO transcripts2 (provider_id) VALUES ('test');
-- Don't manually set id unless you have valid UUID
```

---

## Offline Mode

When Supabase is not configured, backend runs in offline mode:

```typescript
// In lib/supabase.ts
function getClient(): SupabaseClient {
  if (!process.env.SUPABASE_URL) {
    console.warn('[Supabase] Running in offline mode');
    return mockClient;  // Returns mock that doesn't persist
  }
  // ...
}
```

**Features in offline mode:**
- Recording works
- Transcription works
- Data NOT persisted
- Good for development/testing

---

## Quick Diagnostics

```bash
# 1. Test connection
curl "$SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"

# 2. List tables
curl "$SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# 3. Query transcripts
curl "$SUPABASE_URL/rest/v1/transcripts2?select=id,status&limit=5" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

---

## Error Code Reference

| Code | Meaning | Action |
|------|---------|--------|
| 42P01 | Table missing | Run schema SQL |
| 42501 | RLS violation | Use service_role key |
| 23503 | FK violation | Insert parent first |
| 22P02 | Invalid UUID | Validate format |
| PGRST301 | JWT expired | Refresh/use service key |
| PGRST000 | Network error | Check URL/connection |
