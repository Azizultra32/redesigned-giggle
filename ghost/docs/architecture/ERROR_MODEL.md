# Error Model

## Error Categories

### 1. Connection Errors

Failures in network communication.

| Error | Source | Recovery |
|-------|--------|----------|
| WebSocket disconnect | Network | Auto-reconnect |
| Deepgram connection failed | API | Notify user, retry |
| Supabase unreachable | Database | Queue operations |

### 2. Permission Errors

Missing user permissions.

| Error | Source | Recovery |
|-------|--------|----------|
| Microphone denied | Browser | Show permission dialog |
| Storage access denied | Extension | Request permission |

### 3. Processing Errors

Failures during data processing.

| Error | Source | Recovery |
|-------|--------|----------|
| Invalid audio format | Extension | Log, skip |
| Chunk save failed | Supabase | Retry queue |
| Transcript parse error | Deepgram | Log, continue |

### 4. Configuration Errors

Missing or invalid configuration.

| Error | Source | Recovery |
|-------|--------|----------|
| Missing API key | Environment | Block start |
| Invalid credentials | Supabase | Log error |
| Missing extension permissions | Manifest | Prompt user |

## Error Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Error     │────►│   Handler   │────►│   Action    │
│   Source    │     │   Logic     │     │   Taken     │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │
      │                   ▼                   │
      │            ┌─────────────┐           │
      │            │   Logging   │           │
      │            └─────────────┘           │
      │                   │                   │
      │                   ▼                   │
      │            ┌─────────────┐           │
      └───────────►│   User      │◄──────────┘
                   │   Notify    │
                   └─────────────┘
```

## Error Messages

### Extension to User

```typescript
const errorMessages = {
  'mic_denied': 'Microphone access denied. Please allow microphone access to record.',
  'ws_disconnect': 'Connection lost. Reconnecting...',
  'recording_failed': 'Failed to start recording. Please try again.',
  'server_error': 'Server error. Please check if the backend is running.',
};
```

### Backend to Extension

```typescript
interface ErrorResponse {
  type: 'error';
  error: string;
  code?: string;
  recoverable?: boolean;
}

// Examples
{ type: 'error', error: 'Already recording', code: 'E001', recoverable: true }
{ type: 'error', error: 'Deepgram connection failed', code: 'E002', recoverable: false }
{ type: 'error', error: 'Database write failed', code: 'E003', recoverable: true }
```

## Recovery Strategies

### Auto-Retry

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${i + 1} failed:`, error);

      if (i < maxRetries - 1) {
        await delay(delayMs * Math.pow(2, i)); // Exponential backoff
      }
    }
  }

  throw lastError!;
}
```

### Graceful Degradation

```typescript
// If Supabase fails, continue recording locally
try {
  await saveTranscriptChunks(transcriptId, chunks);
} catch (error) {
  console.error('Supabase save failed, storing locally');
  localChunkBuffer.push(...chunks);
}
```

### User Notification

```typescript
function notifyUser(error: Error, severity: 'info' | 'warning' | 'error') {
  // Send to extension overlay
  ws.send(JSON.stringify({
    type: 'notification',
    message: error.message,
    severity
  }));
}
```

## Logging

### Log Levels

```typescript
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}
```

### Log Format

```typescript
// Backend
console.log(`[${timestamp}] [${component}] [${level}] ${message}`);

// Examples
[2024-01-15T10:30:00Z] [Deepgram] [ERROR] Connection timeout
[2024-01-15T10:30:00Z] [Supabase] [WARN] Retrying save operation
[2024-01-15T10:30:01Z] [WS] [INFO] Client reconnected
```

### Structured Logging

```typescript
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  context?: Record<string, any>;
}
```

## Error Codes

| Code | Category | Description |
|------|----------|-------------|
| E001 | Connection | WebSocket connection failed |
| E002 | Connection | Deepgram connection failed |
| E003 | Database | Supabase operation failed |
| E004 | Permission | Microphone access denied |
| E005 | State | Invalid operation for current state |
| E006 | Config | Missing required configuration |
| E007 | Audio | Invalid audio format |
| E008 | Parse | Failed to parse message |

## Monitoring

### Health Check Endpoint

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {
      supabase: supabaseHealthy,
      deepgram: deepgramHealthy
    }
  });
});
```

### Metrics to Track

- WebSocket connection count
- Recording session count
- Error rate by category
- Chunk save latency
- Deepgram response latency

## Testing Errors

### Simulate Errors

```typescript
// Force Deepgram error
process.env.DEEPGRAM_API_KEY = 'invalid';

// Force Supabase error
process.env.SUPABASE_URL = 'https://invalid.supabase.co';

// Force WebSocket error
ws.close(1006, 'Simulated error');
```
