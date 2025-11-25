# ASSISTMD TRUTH PACKAGE — OPTION A (CLEAN REPO SPEC)

**This is the definitive architecture for rebuilding from scratch.**

Everything verified from top to bottom: API flows, Supabase schema, Deepgram wiring, overlay behavior, CNS agent responsibilities, dashboard behavior, and integration points.

This is written so another AI **cannot possibly misunderstand** the system.

---

## 1. SYSTEM OVERVIEW — 3 MAJOR COMPONENTS

```
[1] AssistMD Overlay (Ferrari UI, runs in browser)
[2] CNS Agent (Node backend: Deepgram + Supabase + /ws + actions)
[3] Supabase (transcripts2 table, only real storage)
```

Optional:

```
[4] MCP / Chrome launcher (developer automation)
[5] Dashboard (monitoring only)
```

You do **NOT** need the dashboard or MCP server for core transcript tests.
They are separate modules.

---

## 2. REPOSITORY STRUCTURE

```
turbo-enigma/
├── apps/
│   ├── cns-agent/              # Backend Server
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   └── index.ts    # All TypeScript interfaces
│   │   │   ├── lib/
│   │   │   │   ├── supabase.ts # Database operations (transcripts2 only)
│   │   │   │   └── ws-bridge.ts# WebSocket Feed A-E multiplexer
│   │   │   ├── audio/
│   │   │   │   ├── chunk-assembler.ts # Word → chunk aggregation
│   │   │   │   └── deepgram-consumer.ts # Deepgram integration
│   │   │   └── server.ts       # Main HTTP/WS server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── .env.example
│   │
│   └── overlay/                # Chrome Extension
│       ├── src/
│       │   ├── overlay.ts      # Ferrari UI (Shadow DOM)
│       │   ├── content.ts      # Content script
│       │   ├── background.ts   # Service worker
│       │   ├── audio-capture.ts# PCM recorder
│       │   ├── bridge.ts       # Messaging
│       │   └── ui/             # UI components
│       ├── manifest.json
│       ├── build.mjs
│       └── package.json
│
├── supabase/                   # Database schemas
│   ├── transcripts2-schema.sql
│   ├── rls-policies.sql
│   └── seed.sql
│
├── scripts/                    # MCP & automation
│   ├── start-mcp.sh
│   └── verify-extension-loaded.mjs
│
└── docs/                       # Documentation
    └── architecture/
        └── SUPABASE_SCHEMA.md
```

---

## 3. THE PROBLEM WE SOLVED (LEGACY CONTEXT)

### Before (Dual-World Chaos)

1. **Two overlapping agents**:
   - `agent-archives-20251124/agent-real/` (Git-tracked, partially updated)
   - `anchor-ground-zero/agent/` (Git-ignored, EADDRINUSE loops, ephemeral)

2. **Schema mismatch**:
   - Code expected: `sessions`, `transcripts`, `doctors` tables
   - Reality: Only `transcripts2` exists in Supabase

3. **Configuration hell**:
   - `.env` conflicts between agents
   - Unclear which Supabase key to use (anon vs service role)
   - Deepgram errors actually Supabase auth failures

4. **Build fragmentation**:
   - Overlay code scattered across `extension/src/overlay.ts` and old backups
   - Extension bundling unclear (content.js vs overlay.js)
   - MCP scripts broken by wrong extension name verification

### After (This Repo)

1. **Single canonical agent**: `apps/cns-agent/` based on agent-real spec
2. **Schema aligned**: All code uses `transcripts2`, no legacy tables
3. **Clear config**: One `.env` per app, explicit service role usage
4. **Clean builds**: Documented bundling, working MCP orchestration

---

## 4. ARCHITECTURE DECISIONS

### 4.1 Why `transcripts2` Instead of Legacy Tables?

**Legacy Design** (What old code expected):
```sql
-- These DO NOT EXIST in current Supabase project
sessions (id, doctor_id, status, started_at, ended_at, metadata)
transcripts (id, session_id, content, speaker, is_final, confidence, chunk_index)
doctors (id, display_name, email)
```

**Current Reality** (What actually exists):
```sql
-- This is the ONLY transcript table
public.transcripts2 (
  id                    bigint PRIMARY KEY,
  user_id               uuid NOT NULL,          -- Replaces doctor_id
  patient_code          text DEFAULT '',        -- Replaces session linkage
  patient_uuid          uuid,                   -- Real EMR patient (future)
  transcript            text,                   -- Flattened full text
  transcript_chunk      jsonb[],                -- Diarized chunks array
  created_at            timestamptz,
  completed_at          timestamptz,
  metadata              jsonb DEFAULT '{}'::jsonb,
  ai_summary            text,
  ai_short_summary      text,
  ai_interim_summaries  jsonb,
  pii_mapping           jsonb,
  token_count           integer,
  language              text DEFAULT 'en'
);
```

**Why This Works Better**:
- **Single source of truth**: One row = one recording session
- **No joins needed**: All data in one place (transcript + chunks + metadata)
- **Incremental writes**: Can update `transcript_chunk` array as we go
- **Patient identity deferred**: Start recording immediately with ephemeral `patient_code`, bind to real patient later via `/dom`

### 4.2 Patient Identity Flow (Two-Phase)

**Problem**: Can't wait for patient lookup to start recording (EMR integration might be slow/unavailable).

**Solution**: Two-phase patient identity:

**Phase 1: Recording Starts (Ephemeral)**
```typescript
// On "Record" button press:
const patientCode = generateEphemeralPatientCode(); // e.g., "PT-A1B2-C3D4"
const transcriptId = await createTranscriptRun({
  user_id: DEMO_DOCTOR_ID,
  patient_code: patientCode,
  patient_uuid: null,  // Unknown yet
  transcript_chunk: []
});
// Start streaming audio to Deepgram
```

**Phase 2: DOM Recognition (Real)**
```typescript
// After overlay sends /dom with EHR page scan:
const domMap = extractFromPage(); // { mrn: "12345", name: "John Doe", dob: "1980-01-01" }
const realPatientId = await lookupPatient(domMap.mrn);
await updateTranscriptRun(transcriptId, {
  patient_uuid: realPatientId,
  metadata: { mrn: domMap.mrn, name: domMap.name, dob: domMap.dob }
});
// Overlay updates header: "PT-A1B2-C3D4" → "John Doe (MRN: 12345)"
```

**Benefits**:
- ✅ Recording starts instantly (no blocking I/O)
- ✅ PHI-free until DOM binding (safer for early dev/testing)
- ✅ Audit trail preserved (`patient_code` never changes, `patient_uuid` added later)
- ✅ Supports offline/demo mode (just skip Phase 2)

### 4.3 Deepgram Chunking Strategy

**Problem**: Deepgram returns word-level timestamps, but we want sentence/paragraph-level chunks for display and LLM context.

**Solution**: ChunkAssembler

**Input** (from Deepgram):
```json
{
  "channel": {
    "alternatives": [
      {
        "words": [
          { "word": "Patient", "start": 12.34, "end": 12.89, "speaker": 0, "confidence": 0.98 },
          { "word": "reports", "start": 13.01, "end": 13.45, "speaker": 0, "confidence": 0.99 },
          ...
        ]
      }
    ]
  },
  "is_final": true,
  "speech_final": true
}
```

**Aggregation Rules**:
1. Group words by `speaker` (0, 1, 2...)
2. Break into new chunk if:
   - Speaker changes, OR
   - Time gap > 30 seconds from chunk start
3. Preserve word-level data in `raw[]` field

**Output** (to Supabase `transcript_chunk`):
```json
{
  "speaker": 0,
  "text": "Patient reports chest pain for two hours, radiating to left arm",
  "start": 12.34,
  "end": 42.10,
  "word_count": 12,
  "raw": [
    { "word": "Patient", "start": 12.34, "end": 12.89, "speaker": 0, "confidence": 0.98 },
    ...
  ]
}
```

**Code Location**: `apps/cns-agent/src/audio/chunk-assembler.ts`

### 4.4 WebSocket Event Model (Feed A-E)

**Problem**: Multiple subsystems (Deepgram, VoiceConcierge, EmergencyMonitor, etc.) need to broadcast to overlay and dashboard independently.

**Solution**: Central `WsBridge` with labeled feeds.

**Feeds**:
- **Feed A**: Deepgram Transcription (connected/disconnected/ready)
- **Feed B**: Voice Concierge (command recognition)
- **Feed C**: Emergency Monitor (alert keywords)
- **Feed D**: Patient Summary (AI summarization)
- **Feed E**: Compliance Audit (documentation gaps)

**Message Types**:

1. **Status** (Feed state updates):
```typescript
{
  type: "status",
  data: {
    feed: "A" | "B" | "C" | "D" | "E",
    label: "Deepgram Transcription",
    status: "connected" | "disconnected" | "ready" | "error",
    timestamp: "2025-11-25T12:34:56.789Z"
  }
}
```

2. **Transcript** (Real-time text):
```typescript
{
  type: "transcript",
  data: {
    feed: "A",
    text: "Patient reports chest pain",
    isFinal: true,
    confidence: 0.92,
    speaker: 0,
    timestamp: "2025-11-25T12:34:56.789Z"
  }
}
```

3. **Alert** (Emergency/compliance):
```typescript
{
  type: "alert",
  data: {
    feed: "C",
    severity: "critical" | "warning" | "info",
    message: "Patient mentioned chest pain - consider cardiac workup",
    keywords: ["chest pain"],
    timestamp: "2025-11-25T12:34:56.789Z"
  }
}
```

4. **Command** (Voice commands):
```typescript
{
  type: "command",
  data: {
    feed: "B",
    command: "trigger_map" | "smart_fill" | "undo_fill" | "dictate",
    payload: { intent: "Insert normal physical exam template" },
    timestamp: "2025-11-25T12:34:56.789Z"
  }
}
```

**Hydration on Connect**:
When a new WebSocket client connects, CNS immediately sends current state of all feeds:
```typescript
ws.send({ type: "status", data: { feed: "A", label: "Deepgram Transcription", status: "connected" }});
ws.send({ type: "status", data: { feed: "B", label: "Voice Concierge", status: "ready" }});
ws.send({ type: "status", data: { feed: "C", label: "Emergency Monitor", status: "ready" }});
ws.send({ type: "status", data: { feed: "D", label: "Patient Summary", status: "connected" }});
ws.send({ type: "status", data: { feed: "E", label: "Compliance Audit", status: "connected" }});
```

**Code Location**: `apps/cns-agent/src/lib/ws-bridge.ts`

---

## 5. DATA FLOW END-TO-END

### Full Recording Session

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER: Clicks "Record" in overlay                         │
└────────────┬────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. OVERLAY: audio-capture.ts starts WebAudio recording      │
│    - Sample rate: 16kHz                                     │
│    - Format: PCM (Int16Array)                               │
│    - Chunk size: 4096 samples                               │
└────────────┬────────────────────────────────────────────────┘
             ▼ Binary audio chunks
┌─────────────────────────────────────────────────────────────┐
│ 3. CNS: DeepgramConsumer receives audio                     │
│    a. createTranscriptRun() → Supabase INSERT               │
│       - user_id: DEMO_DOCTOR_ID                             │
│       - patient_code: "PT-A1B2-C3D4" (generated)            │
│       - transcript_chunk: []                                │
│       → Returns transcript ID 123                           │
│    b. Connect to Deepgram live API                          │
│       - Model: nova-2-medical                               │
│       - Diarization: true                                   │
│       - smart_format: true                                  │
│       - interim_results: true                               │
└────────────┬────────────────────────────────────────────────┘
             ▼ Audio stream
┌─────────────────────────────────────────────────────────────┐
│ 4. DEEPGRAM: Returns word-level transcripts                 │
│    { "is_final": true, "speech_final": true,               │
│      "channel": { "alternatives": [{                        │
│        "words": [                                           │
│          {"word": "Patient", "start": 12.34, "end": 12.89, │
│           "speaker": 0, "confidence": 0.98}                 │
│        ]                                                    │
│      }]}}                                                   │
└────────────┬────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. CNS: ChunkAssembler aggregates words                     │
│    - Group by speaker (0, 1, 2...)                         │
│    - Break at speaker change or 30s window                 │
│    - Produce chunk:                                         │
│      { "speaker": 0, "text": "Patient reports...",         │
│        "start": 12.34, "end": 42.10,                       │
│        "word_count": 7, "raw": [...] }                     │
└────────────┬────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. CNS: saveTranscriptChunks() → Supabase UPDATE            │
│    UPDATE public.transcripts2                               │
│    SET transcript_chunk = <full chunks array>,              │
│        transcript = <flattened text>,                       │
│        completed_at = NULL (still recording)                │
│    WHERE id = 123;                                          │
└────────────┬────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. CNS: WsBridge broadcasts to all clients                  │
│    ws.send({                                                │
│      type: "transcript",                                    │
│      data: { feed: "A", text: "Patient reports...",        │
│              isFinal: true, confidence: 0.92,               │
│              speaker: 0, timestamp: "..." }                 │
│    });                                                      │
└────────────┬────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. OVERLAY: Transcript tab updates                          │
│    - Append line: "[Doctor] Patient reports..."            │
│    - Badge: [Final] (vs [Interim])                         │
│    - Confidence: 92%                                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 9. USER: Clicks "Stop" in overlay                          │
└────────────┬────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. CNS: DeepgramConsumer cleanup                           │
│     - Flush remaining chunks                                │
│     - Update Supabase: completed_at = NOW()                 │
│     - Disconnect from Deepgram                              │
│     - Emit final status to WsBridge                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. API ENDPOINTS

### HTTP Endpoints

| Endpoint | Method | Description | Request | Response |
|----------|--------|-------------|---------|----------|
| `/health` | GET | Health check | - | `{ status, timestamp, version, service, feeds }` |
| `/demo/patient` | GET | Generate ephemeral patient code | - | `{ patientCode, message }` |
| `/dom` | POST | Bind patient via DOM scan | `{ transcriptId, domMap }` | `{ success, transcriptId, patientUuid, metadata }` |
| `/patient/current` | GET | Get latest transcript for user | `?userId=<uuid>` | TranscriptRun object |
| `/transcripts/:id` | GET | Get specific transcript | - | TranscriptRun object |

### WebSocket Messages (Client → Server)

| Message Type | Purpose | Payload |
|-------------|---------|---------|
| `start_recording` | Start new recording session | `{ patientCode?, patientUuid? }` |
| `stop_recording` | Stop active recording | - |
| `ping` | Keep-alive check | - |

### WebSocket Messages (Server → Client)

| Message Type | Purpose | Data |
|-------------|---------|------|
| `connected` | Connection established | `{ userId }` |
| `recording_started` | Recording began | `{ transcriptId, patientCode }` |
| `recording_stopped` | Recording ended | `{ transcriptId }` |
| `status` | Feed status update | `{ feed, label, status, timestamp }` |
| `transcript` | Real-time transcript | `{ feed, text, isFinal, confidence, speaker, timestamp }` |
| `alert` | Emergency/compliance alert | `{ feed, severity, message, keywords, timestamp }` |
| `command` | Voice command recognized | `{ feed, command, payload, timestamp }` |
| `error` | Error occurred | `{ error }` |
| `pong` | Response to ping | `{ timestamp }` |

---

## 7. KEY FILES REFERENCE

| File | Purpose | When to Edit |
|---|---|---|
| `apps/cns-agent/src/server.ts` | Main HTTP/WS server | Add new endpoints |
| `apps/cns-agent/src/audio/deepgram-consumer.ts` | Deepgram integration | Change audio config |
| `apps/cns-agent/src/audio/chunk-assembler.ts` | Word → chunk logic | Adjust chunk size/rules |
| `apps/cns-agent/src/lib/supabase.ts` | Supabase helpers | Add new DB operations |
| `apps/cns-agent/src/lib/ws-bridge.ts` | WebSocket multiplexer | Add new event types |
| `apps/cns-agent/src/types/index.ts` | Type definitions | Add new interfaces |
| `apps/overlay/src/overlay.ts` | Ferrari UI logic | Change overlay behavior |
| `apps/overlay/src/audio-capture.ts` | WebAudio recording | Audio format changes |
| `apps/overlay/manifest.json` | Extension metadata | Permissions, name, version |
| `supabase/transcripts2-schema.sql` | Database schema | Schema evolution |
| `scripts/start-mcp.sh` | Chrome + extension launch | MCP orchestration |
| `docs/architecture/SUPABASE_SCHEMA.md` | Full table schemas | Documentation updates |

---

## 8. TROUBLESHOOTING GUIDE

### "EADDRINUSE: address already in use :::3001"

**Cause**: Multiple `tsx watch` processes running.

**Fix**:
```bash
lsof -ti:3001 | xargs kill -9
cd apps/cns-agent && npm run dev
```

### "Invalid API key" from Supabase

**Cause**: Using `SUPABASE_ANON_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY`.

**Fix**:
```bash
# In apps/cns-agent/.env:
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...  # Not anon key!
```

**Why**: Backend writes need service role to bypass RLS.

### Extension Not Loading in Chrome

**Cause**: Wrong manifest name in verification script.

**Fix**:
```bash
# Edit scripts/verify-extension-loaded.mjs:
const targetName = "AssistMD Ghost Overlay (MVP)";  # Must match manifest.json
```

### Deepgram Connection Failed

**Test**:
```bash
curl -X GET "https://api.deepgram.com/v1/projects" \
  -H "Authorization: Token $DEEPGRAM_API_KEY"
```

**If 401**: Key is invalid, regenerate in Deepgram console.  
**If 200**: Key works, check CNS logs for actual error.

### Transcript Chunks Not Appearing in DB

**Check**:
```sql
SELECT 
  id,
  patient_code,
  jsonb_array_length(transcript_chunk) as chunk_count,
  transcript,
  completed_at
FROM public.transcripts2
ORDER BY created_at DESC
LIMIT 1;
```

**If chunk_count = 0**:
- Verify `speech_final: true` events from Deepgram (check CNS logs)
- Ensure `chunkAssembler.finalizeChunk()` is called on final events
- Check `saveTranscriptChunks()` isn't silently failing (add logging)

---

## 9. ENVIRONMENT SETUP

### Backend (apps/cns-agent/.env)
```env
PORT=3001
DEEPGRAM_API_KEY=your_deepgram_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_key
DEMO_DOCTOR_ID=00000000-0000-0000-0000-000000000000
```

**Note**: Without Supabase credentials, backend runs in offline mode (no persistence).

---

## 10. MIGRATION FROM LEGACY

### What Changed

| Legacy Design | Current Reality | Why |
|---|---|---|
| `sessions` table | No `sessions` table | `transcripts2` serves same purpose |
| `transcripts` table | `transcripts2` table | Single source of truth |
| `doctors` table | `auth.users` + env var | Simplified for POC |
| session_id FK | `patient_code` text | Ephemeral identity, no FK yet |
| Multi-insert (sessions + transcripts) | Single-insert (transcripts2) | Atomic writes, simpler logic |
| `/demo/patient` joins 3 tables | `/patient/current` reads 1 row | No joins needed |
| `/sessions/:id/transcripts` returns array | `/transcripts/:id` returns single row | Chunks in JSONB array |

### What Stayed the Same

- Deepgram integration (model, diarization, chunking strategy)
- WebSocket event model (status, transcript, alert, command)
- DOM scanning via `/dom` endpoint
- Overlay UI structure (tabs, recorder pill, actions)

### What's Coming (Phase 2+)

- Real `patients` table with MRN/DOB/name
- Update `transcripts2.patient_uuid` via DOM recognition
- Multi-visit continuity (link transcripts to encounters)
- Voice Concierge, Emergency Monitor, Patient Summary (Feeds B-E)

---

## 11. NEXT STEPS FOR CODEX/WEB

When feeding this to Codex for a rebuild:

1. **Start with types**: Define all TypeScript interfaces in `apps/cns-agent/src/types/index.ts`
2. **Build Supabase layer**: Implement `apps/cns-agent/src/lib/supabase.ts` exactly per spec
3. **Stub HTTP server**: Get `/health`, `/dom`, `/patient/current`, `/transcripts/:id` working
4. **Add WebSocket**: Implement `WsBridge` with Feed A status broadcasting
5. **Integrate Deepgram**: Connect `DeepgramConsumer` with `ChunkAssembler`
6. **Wire overlay**: Build overlay UI that hits all CNS endpoints
7. **Test end-to-end**: Use MCP to verify full recording flow

**Critical**: Codex must understand:
- There are NO `sessions`/`transcripts`/`doctors` tables, only `transcripts2`
- Patient identity is two-phase (ephemeral → real)
- Chunks are aggregated server-side before DB write
- WebSocket uses labeled feeds (A-E), not direct transcript events

---

## 12. SUMMARY

This architecture solves the dual-world problem by:

1. **Single agent implementation** (`apps/cns-agent/`)
2. **Schema alignment** (only `transcripts2` used)
3. **Clear patient identity flow** (ephemeral → DOM-bound)
4. **Robust chunking** (30s per-speaker aggregation)
5. **Clean WebSocket model** (Feed A-E with hydration)
6. **Documented MCP orchestration** (reliable Chrome + extension loading)

The system is now **Codex-rebuildable** with no ambiguity about table names, endpoints, or data flow.

---

**Generated**: 2025-11-25  
**Version**: 1.0.0  
**Status**: ✅ Implemented
