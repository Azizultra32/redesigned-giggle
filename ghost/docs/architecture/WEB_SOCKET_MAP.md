# WebSocket Map

## Endpoints

### `/ws` - Main Command Channel

The primary WebSocket endpoint for all extension communication.

```
ws://localhost:3001/ws?userId=user-123
```

#### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `userId` | No | User identifier (defaults to 'anonymous') |

#### Message Types

See [COMMAND_FLOW.md](./COMMAND_FLOW.md) for detailed message documentation.

### `/audio-stream` - Legacy Audio Endpoint

Alternative endpoint for simple audio-only clients. Redirects to `/ws`.

```
ws://localhost:3001/audio-stream
```

## Connection Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WebSocket Connection Lifecycle                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   CONNECTING ──► OPEN ──► CLOSING ──► CLOSED                       │
│                   │                                                 │
│                   │                                                 │
│                   ▼                                                 │
│            ┌─────────────┐                                          │
│            │   Session   │                                          │
│            │   Created   │                                          │
│            └─────────────┘                                          │
│                   │                                                 │
│         ┌────────┴────────┐                                        │
│         ▼                 ▼                                         │
│   ┌──────────┐     ┌──────────┐                                    │
│   │   Idle   │◄───►│Recording │                                    │
│   └──────────┘     └──────────┘                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Session State

```typescript
interface Session {
  ws: WebSocket;           // WebSocket connection
  userId: string;          // User identifier
  transcriptId: number;    // Active transcript ID (null if idle)
  deepgram: DeepgramConsumer;  // Deepgram connection (null if idle)
  pendingChunks: TranscriptChunk[];  // Chunks awaiting save
  isRecording: boolean;    // Recording state
}
```

## Message Routing

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Message Router                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Incoming Message                                                  │
│         │                                                           │
│         ▼                                                           │
│   ┌───────────┐                                                    │
│   │  Binary?  │──Yes──► Forward to Deepgram                        │
│   └─────┬─────┘                                                    │
│         │ No                                                        │
│         ▼                                                           │
│   ┌───────────┐                                                    │
│   │   Parse   │                                                    │
│   │   JSON    │                                                    │
│   └─────┬─────┘                                                    │
│         │                                                           │
│         ▼                                                           │
│   ┌───────────────────────────────────────┐                        │
│   │            Command Handler             │                        │
│   ├───────────────────────────────────────┤                        │
│   │ start_recording → startRecording()    │                        │
│   │ stop_recording  → stopRecording()     │                        │
│   │ set_patient     → setPatient()        │                        │
│   │ ping            → pong                │                        │
│   └───────────────────────────────────────┘                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Reconnection Strategy

### Extension Side

```javascript
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

ws.onclose = () => {
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    setTimeout(() => {
      reconnectAttempts++;
      connectWebSocket();
    }, RECONNECT_DELAY);
  }
};

ws.onopen = () => {
  reconnectAttempts = 0;
};
```

### Backend Side

Backend accepts new connections but doesn't actively reconnect. State is lost on disconnect.

## Concurrent Connections

- Each browser tab creates its own WebSocket connection
- Each connection gets its own session
- Sessions are independent (no shared state between tabs)

## Security Considerations

### Current (Development)

- No authentication
- `userId` from query parameter

### Production Recommendations

1. **JWT Authentication**
   ```javascript
   ws://host/ws?token=jwt_token
   ```

2. **Origin Validation**
   ```typescript
   wss.on('connection', (ws, req) => {
     const origin = req.headers.origin;
     if (!isAllowedOrigin(origin)) {
       ws.close(4001, 'Unauthorized');
       return;
     }
   });
   ```

3. **Rate Limiting**
   - Limit connections per IP
   - Limit messages per second

## WebSocket Server Configuration

```typescript
const wss = new WebSocketServer({
  server,              // HTTP server to attach to
  path: '/ws',         // URL path
  clientTracking: true // Track connected clients
});
```

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome | Full |
| Firefox | Full |
| Safari | Full |
| Edge | Full |

### MV3 Considerations

Chrome MV3 extensions can use WebSocket in content scripts:

```javascript
// content.js - Works in MV3
const ws = new WebSocket('ws://localhost:3001/ws');
```

Service workers have limitations with persistent connections. Use content script for WebSocket.

## Debugging

### Chrome DevTools

1. Open DevTools (F12)
2. Go to Network tab
3. Filter by "WS"
4. Click connection to see messages

### Backend Logging

```typescript
wss.on('connection', (ws, req) => {
  console.log('[WS] New connection:', req.url);
});

ws.on('message', (data) => {
  if (!Buffer.isBuffer(data)) {
    console.log('[WS] Message:', JSON.parse(data.toString()));
  }
});
```
