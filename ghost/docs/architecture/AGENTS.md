# GHOST-NEXT Agents Architecture

## Overview

The "agent" in GHOST-NEXT refers to the backend server component that processes audio and manages transcripts. It acts as an intermediary between the browser extension and external services (Deepgram, Supabase).

## Agent Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Backend Agent                          │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  WebSocket  │    │  Deepgram   │    │  Supabase   │     │
│  │   Broker    │◄──►│  Consumer   │──► │  Queries    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         ▲                                                   │
│         │                                                   │
│         │ WebSocket /ws                                     │
│         │                                                   │
└─────────┼───────────────────────────────────────────────────┘
          │
          │
    ┌─────┴─────┐
    │  Browser  │
    │ Extension │
    └───────────┘
```

## WebSocket Broker

The broker manages WebSocket connections and session state:

```typescript
class WebSocketBroker {
  private sessions: Map<WebSocket, Session>;

  handleConnection(ws, req) {
    // Create session
    // Handle messages
    // Manage lifecycle
  }

  handleMessage(ws, data) {
    if (Buffer.isBuffer(data)) {
      // Audio data -> Deepgram
    } else {
      // JSON command -> Process
    }
  }
}
```

### Session Object

```typescript
interface Session {
  ws: WebSocket;
  userId: string;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
}
```

## Deepgram Consumer

Handles streaming transcription:

```typescript
class DeepgramConsumer {
  async connect() {
    // Initialize Deepgram client
    // Configure streaming options
    // Set up event handlers
  }

  sendAudio(data: Buffer) {
    // Forward PCM to Deepgram
  }

  handleTranscript(data) {
    // Parse transcript
    // Emit events
    // Feed to aggregator
  }
}
```

## Chunk Aggregator

Assembles words into chunks:

```typescript
class ChunkAggregator {
  private currentChunk: AggregatedChunk | null;

  addWord(word) {
    // Check speaker change
    // Check duration limit
    // Append or flush
  }

  forceFlush() {
    // Complete current chunk
    // Emit to callback
  }
}
```

## Data Flow

### Recording Start

```
Extension                  Agent                    Services
    │                        │                         │
    │── start_recording ────►│                         │
    │                        │── createTranscriptRun ─►│ Supabase
    │                        │◄── transcriptId ────────│
    │                        │── connect() ───────────►│ Deepgram
    │◄── recording_started ──│                         │
```

### Audio Streaming

```
Extension                  Agent                    Services
    │                        │                         │
    │── [PCM audio] ────────►│                         │
    │                        │── [audio] ─────────────►│ Deepgram
    │                        │◄── transcript ──────────│
    │◄── transcript ─────────│                         │
    │                        │                         │
    │                        │── (accumulate chunks) ──│
    │                        │── saveChunks ──────────►│ Supabase
```

### Recording Stop

```
Extension                  Agent                    Services
    │                        │                         │
    │── stop_recording ─────►│                         │
    │                        │── disconnect() ────────►│ Deepgram
    │                        │── saveChunks (final) ──►│ Supabase
    │                        │── updateTranscript ────►│ Supabase
    │◄── recording_stopped ──│                         │
```

## Error Handling

### Deepgram Errors

```typescript
deepgram.onError = (error) => {
  // Log error
  // Notify extension
  // Attempt reconnection (if appropriate)
};
```

### Supabase Errors

```typescript
try {
  await saveChunks(transcriptId, chunks);
} catch (error) {
  // Re-queue chunks for retry
  // Log error
  pendingChunks.unshift(...chunks);
}
```

### WebSocket Errors

```typescript
ws.on('error', (error) => {
  // Log error
  // Clean up session
  // Stop recording if active
});
```

## Batch Processing

Chunks are saved in batches to reduce database calls:

```typescript
// Save every 5 seconds
const saveInterval = setInterval(() => {
  if (pendingChunks.length > 0) {
    saveTranscriptChunks(transcriptId, pendingChunks);
    pendingChunks = [];
  }
}, 5000);
```

## Scaling Considerations

### Current Design (Single Server)

- All sessions on one server
- In-memory session state
- Direct Deepgram connections

### Future Scaling

1. **Horizontal scaling**: Load balancer + sticky sessions
2. **Session store**: Redis for shared state
3. **Queue processing**: Separate workers for chunk saving
4. **Connection pooling**: Shared Deepgram connections

## Environment Variables

```bash
PORT=3001
DEEPGRAM_API_KEY=xxxxx
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```
