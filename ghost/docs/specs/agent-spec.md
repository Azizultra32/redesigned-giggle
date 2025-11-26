# Agent Specification

## Overview

The GHOST-NEXT Agent is a Node.js backend server that bridges the browser extension with Deepgram and Supabase.

## Requirements

### Functional

1. **WebSocket Server**
   - Accept connections on `/ws`
   - Handle JSON commands
   - Handle binary audio data
   - Manage session state

2. **Audio Processing**
   - Forward PCM to Deepgram
   - Receive transcript events
   - Aggregate chunks by speaker

3. **Database Operations**
   - Create transcript runs
   - Save transcript chunks
   - Update transcript metadata
   - Complete transcript sessions

4. **Patient Management**
   - Accept patient code
   - Accept patient UUID
   - Update transcript records

### Non-Functional

1. **Performance**
   - < 100ms transcript latency
   - Support 10+ concurrent sessions
   - Handle 5 min+ recordings

2. **Reliability**
   - Auto-reconnect to Deepgram
   - Retry failed saves
   - Graceful shutdown

3. **Security**
   - Service role key protected
   - No client-side key exposure
   - Input validation

## API Specification

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/stats` | GET | Server statistics |
| `/demo/patient` | GET | Generate demo patient code |
| `/demo/patient/validate` | POST | Validate patient code |

### WebSocket Protocol

See [COMMAND_FLOW.md](../architecture/COMMAND_FLOW.md)

## Module Specification

### server.ts

Main entry point:
- Express app setup
- WebSocket server creation
- Broker initialization
- Graceful shutdown handlers

### ws/broker.ts

Session management:
- Connection handling
- Message routing
- Deepgram lifecycle
- Chunk batching

### audio/deepgram-consumer.ts

Deepgram integration:
- Streaming connection
- Transcript event handling
- Chunk aggregation

### supabase/client.ts

Database client:
- Singleton pattern
- Mock client for offline dev
- Connection management

### supabase/queries.ts

Database operations:
- createTranscriptRun
- saveTranscriptChunks
- updateTranscriptRun
- updatePatientInfo
- getFullTranscript
- getChunks

### utils/diarization.ts

Chunk aggregation:
- Word accumulation
- Speaker change detection
- Duration limit enforcement

### utils/patient.ts

Patient utilities:
- Code validation
- UUID validation
- Demo code generation

## Data Flow

```
Extension → WebSocket → Broker → Deepgram
                          ↓
                    Aggregator
                          ↓
                      Supabase
```

## Error Handling

| Error | Response | Recovery |
|-------|----------|----------|
| Deepgram connect fail | `error` event | User retry |
| Supabase save fail | Re-queue chunks | Auto-retry |
| Invalid command | `error` event | Continue |
| WebSocket error | Log + cleanup | Client reconnect |

## Configuration

Environment variables:

```bash
PORT=3001                          # Server port
DEEPGRAM_API_KEY=xxx              # Deepgram API key
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx     # Service role (bypasses RLS)
```

## Session Lifecycle

```
CONNECTED → IDLE → RECORDING → IDLE → DISCONNECTED
              ↑________↓
```

States:
- **CONNECTED**: WebSocket open, no recording
- **IDLE**: Ready to record
- **RECORDING**: Deepgram active, audio streaming
- **DISCONNECTED**: WebSocket closed, cleanup complete
