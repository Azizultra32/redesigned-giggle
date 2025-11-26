# Command Flow

## Overview

Commands flow bidirectionally between the extension and backend via WebSocket.

## Command Types

### Client → Server

| Command | Description | Payload |
|---------|-------------|---------|
| `start_recording` | Begin transcription session | `patientCode?`, `patientUuid?` |
| `stop_recording` | End transcription session | - |
| `set_patient` | Update patient info | `patientCode`, `patientUuid?` |
| `ping` | Keep-alive | - |
| `[binary]` | PCM audio data | Raw audio buffer |

### Server → Client

| Event | Description | Payload |
|-------|-------------|---------|
| `connected` | Connection established | `userId` |
| `recording_started` | Session created | `transcriptId` |
| `recording_stopped` | Session completed | `transcriptId` |
| `transcript` | Transcript update | `text`, `speaker`, `isFinal`, `start`, `end` |
| `chunk` | Chunk saved | `speaker`, `text`, `wordCount`, `duration` |
| `patient_set` | Patient info updated | `patientCode` |
| `pong` | Keep-alive response | `timestamp` |
| `error` | Error occurred | `error` |

## Flow Diagrams

### Connection Flow

```
┌──────────┐                              ┌──────────┐
│Extension │                              │ Backend  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │──── WebSocket connect ─────────────────►│
     │     /ws?userId=xxx                      │
     │                                         │
     │◄─── { type: "connected" } ─────────────│
     │                                         │
```

### Start Recording Flow

```
┌──────────┐                              ┌──────────┐
│Extension │                              │ Backend  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │──── { type: "start_recording",         │
     │       patientCode: "ENC-2024-001" } ──►│
     │                                         │
     │                                    [Create transcript in Supabase]
     │                                    [Connect to Deepgram]
     │                                         │
     │◄─── { type: "recording_started",       │
     │       transcriptId: 12345 } ───────────│
     │                                         │
```

### Audio Streaming Flow

```
┌──────────┐                              ┌──────────┐
│Extension │                              │ Backend  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │──── [Binary PCM data] ────────────────►│
     │                                    [Forward to Deepgram]
     │                                         │
     │                                    [Deepgram returns transcript]
     │                                         │
     │◄─── { type: "transcript",              │
     │       text: "Hello",                   │
     │       speaker: 0,                      │
     │       isFinal: false } ────────────────│
     │                                         │
     │──── [Binary PCM data] ────────────────►│
     │                                         │
     │◄─── { type: "transcript",              │
     │       text: "Hello doctor",            │
     │       speaker: 0,                      │
     │       isFinal: true } ─────────────────│
     │                                         │
```

### Chunk Save Flow

```
┌──────────┐                              ┌──────────┐
│Extension │                              │ Backend  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │                                    [Chunk aggregator completes chunk]
     │                                    [Save to Supabase]
     │                                         │
     │◄─── { type: "chunk",                   │
     │       speaker: 0,                      │
     │       text: "Hello doctor...",         │
     │       wordCount: 5 } ──────────────────│
     │                                         │
```

### Stop Recording Flow

```
┌──────────┐                              ┌──────────┐
│Extension │                              │ Backend  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │──── { type: "stop_recording" } ───────►│
     │                                         │
     │                                    [Disconnect Deepgram]
     │                                    [Flush remaining chunks]
     │                                    [Mark transcript complete]
     │                                         │
     │◄─── { type: "recording_stopped",       │
     │       transcriptId: 12345 } ───────────│
     │                                         │
```

### Error Flow

```
┌──────────┐                              ┌──────────┐
│Extension │                              │ Backend  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │──── { type: "start_recording" } ──────►│
     │                                         │
     │                                    [Deepgram connection fails]
     │                                         │
     │◄─── { type: "error",                   │
     │       error: "Failed to connect to     │
     │              transcription service" } ─│
     │                                         │
```

## Message Format

### JSON Messages

```typescript
// Request
{
  type: string;
  [key: string]: any;
}

// Response
{
  type: string;
  [key: string]: any;
}
```

### Binary Messages

Audio data is sent as raw binary:

```javascript
// Extension sends
ws.send(pcmBuffer);  // ArrayBuffer or Buffer

// Backend receives
ws.on('message', (data) => {
  if (Buffer.isBuffer(data)) {
    // This is audio data
    deepgram.sendAudio(data);
  }
});
```

## Keep-Alive

Optional ping/pong for connection health:

```javascript
// Extension
setInterval(() => {
  ws.send(JSON.stringify({ type: 'ping' }));
}, 30000);

// Backend responds
{ type: 'pong', timestamp: 1703123456789 }
```

## Error Codes

| Error | Description |
|-------|-------------|
| `Already recording` | Tried to start when already recording |
| `Not recording` | Tried to stop when not recording |
| `No active transcript` | Tried to set patient without transcript |
| `Invalid message format` | Malformed JSON |
| `Failed to connect to transcription service` | Deepgram connection failed |
