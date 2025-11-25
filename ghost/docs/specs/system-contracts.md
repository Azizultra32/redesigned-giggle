# System Contracts

## Overview

This document defines the contracts between system components. Any change to these contracts requires updating all dependent components.

## API Contracts

### WebSocket /ws

#### Connection

```
ws://localhost:3001/ws?userId={userId}
```

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| userId | string | No | 'anonymous' |

#### Messages: Client → Server

##### start_recording

```typescript
{
  type: 'start_recording';
  patientCode?: string;
  patientUuid?: string;
}
```

##### stop_recording

```typescript
{
  type: 'stop_recording';
}
```

##### set_patient

```typescript
{
  type: 'set_patient';
  patientCode: string;
  patientUuid?: string;
}
```

##### ping

```typescript
{
  type: 'ping';
}
```

##### Binary Audio

```
Buffer: PCM 16-bit, 16kHz, mono
```

#### Messages: Server → Client

##### connected

```typescript
{
  type: 'connected';
  userId: string;
}
```

##### recording_started

```typescript
{
  type: 'recording_started';
  transcriptId: number;  // BIGINT
}
```

##### recording_stopped

```typescript
{
  type: 'recording_stopped';
  transcriptId: number;
}
```

##### transcript

```typescript
{
  type: 'transcript';
  text: string;
  speaker: number;
  isFinal: boolean;
  start: number;
  end: number;
}
```

##### chunk

```typescript
{
  type: 'chunk';
  speaker: number;
  text: string;
  wordCount: number;
  duration: number;
}
```

##### error

```typescript
{
  type: 'error';
  error: string;
}
```

##### pong

```typescript
{
  type: 'pong';
  timestamp: number;
}
```

## Data Contracts

### TranscriptChunk

```typescript
interface TranscriptChunk {
  speaker: number;       // 0-49
  text: string;          // Non-empty
  start: number;         // >= 0
  end: number;           // > start
  word_count: number;    // > 0
  raw: WordResult[];     // Non-empty array
}
```

### WordResult

```typescript
interface WordResult {
  word: string;          // Non-empty
  start: number;         // >= 0
  end: number;           // > start
  confidence: number;    // 0-1
  speaker: number;       // 0-49
}
```

### PatientInfo

```typescript
interface PatientInfo {
  patientCode: string;   // Format: ENC-YYYY-XXXXX or alphanumeric
  patientUuid?: string;  // UUID format if present
  patientTag?: number;   // Default: 0
}
```

## Database Contracts

### transcripts2 Table

#### Required Fields

| Field | Type | Constraint |
|-------|------|------------|
| id | BIGINT | Primary key, auto-generated |
| user_id | UUID | Not null |
| created_at | TIMESTAMPTZ | Default now() |

#### Optional Fields

All other fields may be null/empty.

#### Invariants

1. `id` is unique and auto-incremented
2. `mid` is unique if set
3. `transcript_chunk` is array of valid TranscriptChunk
4. `transcript` matches content of `transcript_chunk`

## Function Contracts

### createTranscriptRun

```typescript
function createTranscriptRun(
  userId: string,
  patientCode?: string,
  patientUuid?: string
): Promise<number>
```

**Preconditions:**
- `userId` is valid UUID string

**Postconditions:**
- Returns positive BIGINT id
- Row created in transcripts2
- transcript_chunk initialized to []

**Throws:**
- Database error

### saveTranscriptChunks

```typescript
function saveTranscriptChunks(
  transcriptId: number,
  chunks: TranscriptChunk[]
): Promise<void>
```

**Preconditions:**
- `transcriptId` exists in database
- `chunks` is non-empty array of valid TranscriptChunk

**Postconditions:**
- Chunks appended to transcript_chunk
- transcript text rebuilt

**Throws:**
- Database error
- Invalid transcriptId

### updateTranscriptRun

```typescript
function updateTranscriptRun(
  transcriptId: number
): Promise<void>
```

**Preconditions:**
- `transcriptId` exists in database

**Postconditions:**
- completed_at set to current timestamp

**Throws:**
- Database error
- Invalid transcriptId

## Event Contracts

### Deepgram Events

#### Transcript Event

```typescript
{
  type: 'Results';
  channel_index: number[];
  duration: number;
  start: number;
  is_final: boolean;
  channel: {
    alternatives: [{
      transcript: string;
      confidence: number;
      words: WordResult[];
    }];
  };
}
```

#### Utterance End Event

```typescript
{
  type: 'UtteranceEnd';
}
```

## Error Contracts

### Error Response Format

```typescript
{
  type: 'error';
  error: string;      // Human-readable message
  code?: string;      // Error code (E001, E002, etc.)
  recoverable?: boolean;
}
```

### Error Codes

| Code | Description |
|------|-------------|
| E001 | Already recording |
| E002 | Not recording |
| E003 | No active transcript |
| E004 | Invalid message format |
| E005 | Deepgram connection failed |
| E006 | Database operation failed |

## Version Compatibility

Current version: 1.0.0

Breaking changes require:
1. Major version bump
2. Documentation update
3. Migration guide
