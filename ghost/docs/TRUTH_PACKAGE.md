# GHOST-NEXT Truth Package

## Overview

This document is the **single source of truth** for the GHOST-NEXT system. All AI agents and developers should reference this document for authoritative information about the system architecture, data models, and contracts.

## System Purpose

GHOST-NEXT is a voice-powered clinical documentation system consisting of:
- **Chrome Extension (Ferrari Overlay)**: Records audio and displays real-time transcripts
- **Backend Server (CNS Agent)**: Processes audio through Deepgram and stores in Supabase
- **Supabase Database**: Persists transcript data with diarization

## Critical Schema Information

### transcripts2 Table (PRODUCTION)

```sql
CREATE TABLE public.transcripts2 (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  mid UUID DEFAULT gen_random_uuid() UNIQUE,
  ai_summary JSONB,
  ai_short_summary JSONB,
  ai_interim_summaries JSONB[],
  token_count INT4,
  transcript TEXT,
  transcript_chunk JSONB[],
  patient_code TEXT DEFAULT '',
  patient_uuid UUID,
  language TEXT,
  -- Additional fields omitted for brevity
);
```

### KEY FACTS

1. **ID is BIGINT, not UUID**
2. **Field is `user_id`, not `provider_id`**
3. **Chunks stored in `transcript_chunk` JSONB array**
4. **NO separate `transcript_chunks` table**
5. **`patient_code` = AssistMD encounter ID (e.g., "ENC-2024-00001")**

### Chunk Format

```typescript
interface TranscriptChunk {
  speaker: number;      // 0 = Provider, 1+ = Patient
  text: string;         // Punctuated text
  start: number;        // Start time (seconds)
  end: number;          // End time (seconds)
  word_count: number;   // Word count
  raw: WordResult[];    // Deepgram words
}
```

## Code Contracts

### createTranscriptRun

```typescript
async function createTranscriptRun(
  userId: string,
  patientCode?: string,
  patientUuid?: string
): Promise<number>  // Returns BIGINT id
```

### saveTranscriptChunks

```typescript
async function saveTranscriptChunks(
  transcriptId: number,  // BIGINT
  chunks: TranscriptChunk[]
): Promise<void>
```

### updateTranscriptRun

```typescript
async function updateTranscriptRun(
  transcriptId: number
): Promise<void>  // Sets completed_at
```

## Diarization Rules

Chunks are created based on:
1. **Speaker change**: `newWord.speaker !== chunk.speaker`
2. **Duration > 30s**: `(word.end - chunk.start) > 30`
3. **Utterance end**: Deepgram `utterance_end` event

## WebSocket Protocol

### Endpoint

```
ws://localhost:3001/ws?userId={userId}
```

### Client → Server Messages

| Type | Payload |
|------|---------|
| `start_recording` | `{ patientCode?, patientUuid? }` |
| `stop_recording` | `{}` |
| `set_patient` | `{ patientCode, patientUuid? }` |
| `ping` | `{}` |
| Binary | PCM audio data |

### Server → Client Messages

| Type | Payload |
|------|---------|
| `connected` | `{ userId }` |
| `recording_started` | `{ transcriptId }` |
| `recording_stopped` | `{ transcriptId }` |
| `transcript` | `{ text, speaker, isFinal, start, end }` |
| `chunk` | `{ speaker, text, wordCount, duration }` |
| `error` | `{ error }` |
| `pong` | `{ timestamp }` |

## Audio Format

- **Format**: PCM (linear16)
- **Sample Rate**: 16,000 Hz
- **Channels**: 1 (mono)
- **Bit Depth**: 16-bit

## Deepgram Configuration

```typescript
{
  model: 'nova-2',
  language: 'en-US',
  diarize: true,
  interim_results: true,
  utterance_end_ms: 1000,
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1
}
```

## Environment Variables

```bash
# Backend
PORT=3001
DEEPGRAM_API_KEY=xxxxx
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```

## File Structure

```
ghost-next/
├── backend/
│   ├── server.ts              # Main entry
│   ├── supabase/client.ts     # Supabase singleton
│   ├── supabase/queries.ts    # Database ops
│   ├── audio/deepgram-consumer.ts  # Deepgram
│   ├── ws/broker.ts           # WebSocket mgmt
│   └── utils/                 # Utilities
├── extension/
│   ├── manifest.json          # MV3 manifest
│   ├── content.js             # Content script
│   ├── overlay.js             # UI components
│   └── background.js          # Service worker
├── supabase/
│   └── transcripts2-schema.sql
└── docs/                      # This documentation
```

## Quick Reference

### Start System

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Chrome with extension
./scripts/start-mcp.sh
```

### Test Health

```bash
curl http://localhost:3001/health
```

### Generate Demo Patient Code

```bash
curl http://localhost:3001/demo/patient
```

## Documentation Index

- [Architecture](./architecture/SYSTEM_MAP.txt) - Full system map
- [Supabase Schema](./architecture/SUPABASE_SCHEMA.md) - Database details
- [Deepgram Pipeline](./architecture/DEEPGRAM_PIPELINE.md) - Audio processing
- [Overlay System](./architecture/OVERLAY_SYSTEM.md) - Extension UI
- [Command Flow](./architecture/COMMAND_FLOW.md) - WebSocket protocol
- [Workflows](./workflows/) - How-to guides
- [Specs](./specs/) - Detailed specifications
- [Diagrams](./diagrams/) - Visual system maps

## Version

Truth Package Version: 1.0.0
Last Updated: 2024-01-15

---

**This document is authoritative.** When in doubt, defer to the information here.
