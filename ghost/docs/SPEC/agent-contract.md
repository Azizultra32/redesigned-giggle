# Agent Contract Specification

## Overview

This spec defines the exact message contracts between the browser extension (Overlay) and the backend agent.

---

## Transport Layer

### WebSocket Endpoints

| Endpoint | Purpose | Protocol |
|----------|---------|----------|
| `/ws` | Command & transcript channel | JSON messages |
| `/audio-stream` | Raw audio upload | Binary PCM |

### Connection Parameters

```
ws://localhost:3001/ws?providerId=<id>&patientCode=<code>
```

| Param | Required | Description |
|-------|----------|-------------|
| `providerId` | Yes | Clinician identifier |
| `patientCode` | No | Patient MRN (optional at start) |

---

## Message Protocol

All JSON messages follow this envelope:

```typescript
interface Message {
  type: string;           // Event type
  data?: unknown;         // Payload (optional)
  messageId?: string;     // For request/response correlation
  timestamp: number;      // Unix ms
}
```

---

## Overlay → Agent Messages

### `session:start`
Begin a new recording session.

```typescript
{
  type: 'session:start',
  data: {
    providerId: string,
    patientCode?: string,
    metadata?: {
      encounterType?: string,
      location?: string
    }
  },
  timestamp: number
}
```

**Agent Response:**
```typescript
{
  type: 'session:started',
  data: {
    sessionId: string,      // UUID from Supabase
    status: 'ready'
  },
  timestamp: number
}
```

---

### `session:stop`
End the current recording session.

```typescript
{
  type: 'session:stop',
  data: {
    sessionId: string
  },
  timestamp: number
}
```

**Agent Response:**
```typescript
{
  type: 'session:stopped',
  data: {
    sessionId: string,
    chunkCount: number,
    duration: number        // seconds
  },
  timestamp: number
}
```

---

### `audio:chunk`
Send audio data (sent as binary, not JSON).

```
Binary: Int16Array (16-bit PCM, 16kHz, mono)
```

No response expected.

---

### `patient:update`
Update patient info mid-session.

```typescript
{
  type: 'patient:update',
  data: {
    sessionId: string,
    patientCode: string,
    patientName?: string
  },
  timestamp: number
}
```

**Agent Response:**
```typescript
{
  type: 'patient:updated',
  data: {
    patientCode: string,
    patientUuid?: string    // If resolved
  },
  timestamp: number
}
```

---

### `fields:map`
Request DOM field analysis.

```typescript
{
  type: 'fields:map',
  data: {
    fields: Array<{
      id: string,
      selector: string,
      label: string,
      type: string,
      value: string
    }>
  },
  timestamp: number
}
```

**Agent Response:**
```typescript
{
  type: 'fields:mapped',
  data: {
    fields: Array<{
      id: string,
      category: string,     // 'chief_complaint', 'hpi', etc.
      confidence: number
    }>
  },
  timestamp: number
}
```

---

## Agent → Overlay Messages

### `transcript:update`
Real-time transcript from Deepgram.

```typescript
{
  type: 'transcript:update',
  data: {
    id: string,             // Unique chunk ID
    text: string,           // Transcript text
    speaker: string,        // "0", "1", etc.
    isFinal: boolean,       // true = committed
    confidence: number,
    startTime: number,      // seconds
    endTime: number,
    words?: Array<{
      word: string,
      start: number,
      end: number,
      speaker: number
    }>
  },
  timestamp: number
}
```

---

### `connection:status`
Connection state changes.

```typescript
{
  type: 'connection:status',
  data: {
    status: 'connected' | 'disconnected' | 'error',
    deepgram: boolean,      // Deepgram connected
    supabase: boolean       // Supabase connected
  },
  timestamp: number
}
```

---

### `error`
Error notification.

```typescript
{
  type: 'error',
  data: {
    code: string,           // Error code
    message: string,        // Human readable
    recoverable: boolean,   // Can retry
    context?: unknown       // Debug info
  },
  timestamp: number
}
```

**Error Codes:**
| Code | Description |
|------|-------------|
| `AUTH_ERROR` | Invalid API key |
| `CONNECTION_LOST` | WebSocket dropped |
| `DEEPGRAM_ERROR` | Transcription failed |
| `SUPABASE_ERROR` | Database write failed |
| `RATE_LIMIT` | Too many requests |

---

## Binary Audio Protocol

### Format
- Encoding: Linear PCM (16-bit signed)
- Sample rate: 16000 Hz
- Channels: 1 (mono)
- Byte order: Little-endian

### Frame Size
- Recommended: 4096 samples (256ms)
- Maximum: 8192 samples (512ms)

### Streaming Flow
```
Browser Mic
    ↓
AudioWorklet (PCM conversion)
    ↓
WebSocket.send(ArrayBuffer)
    ↓
Agent Server
    ↓
Deepgram.send(Buffer)
```

---

## Sequence Diagrams

### Start Recording
```
Overlay                Agent               Deepgram          Supabase
   │                     │                    │                 │
   │──session:start────▶│                    │                 │
   │                     │──createRun───────────────────────▶│
   │                     │◀──────────id──────────────────────│
   │                     │──connect─────────▶│                 │
   │                     │◀────connected─────│                 │
   │◀─session:started───│                    │                 │
   │                     │                    │                 │
   │══audio:chunk══════▶│══════════════════▶│                 │
   │                     │◀────transcript────│                 │
   │◀─transcript:update─│                    │                 │
   │                     │──────saveChunk──────────────────▶│
```

### Stop Recording
```
Overlay                Agent               Deepgram          Supabase
   │                     │                    │                 │
   │──session:stop─────▶│                    │                 │
   │                     │──finish──────────▶│                 │
   │                     │◀──final chunks────│                 │
   │◀─transcript:update─│                    │                 │
   │                     │──updateStatus───────────────────▶│
   │◀─session:stopped───│                    │                 │
```

---

## Rate Limits

| Operation | Limit |
|-----------|-------|
| WebSocket connections | 10 per IP |
| Audio chunks | 100/sec |
| Messages | 50/sec |
| Supabase writes | 100/min |

---

## Health Check

```
GET /health

Response:
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "services": {
    "deepgram": "connected",
    "supabase": "connected"
  }
}
```
