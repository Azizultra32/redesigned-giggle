# AssistMD Ghost System - Architecture Map

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ASSISTMD GHOST SYSTEM                                │
│                     Voice-Powered Clinical Documentation                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Chrome        │     │    CNS Agent    │     │   Dashboard     │
│   Extension     │◄───►│    (Backend)    │◄───►│   (NextJS)      │
│   (Overlay)     │     │                 │     │                 │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   EHR System    │     │   External      │
│   (DOM)         │     │   Services      │
│                 │     │                 │
└─────────────────┘     └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │ Deepgram  │ │ Supabase  │ │ AI APIs   │
            │ (STT)     │ │ (Storage) │ │ (Future)  │
            └───────────┘ └───────────┘ └───────────┘
```

## Component Details

### 1. Chrome Extension (ghost/extension/)

**Purpose:** Overlay UI that floats on EHR pages, captures audio, maps DOM fields.

**Key Files:**
- `src/overlay.ts` - Ferrari UI (Shadow DOM)
- `src/audio-capture.ts` - PCM audio recording
- `src/domMapper.ts` - EHR field detection
- `src/smart-fill.ts` - Auto-fill execution engine
- `src/state-machine.ts` - Workflow state management
- `src/bridge.ts` - Message routing

**Features:**
- 4 tabs: Transcript, SOAP, Summary, Tasks
- Autopilot pill (red/yellow/green)
- Feed A-E status indicators
- MAP/FILL/UNDO/SEND command bar
- Real-time transcript display

### 2. CNS Agent Backend (ghost/backend/)

**Purpose:** Central nervous system - WebSocket server, audio processing, persistence.

**Key Files:**
- `src/server.ts` - Express + WebSocket server
- `src/lib/command-router.ts` - MAP/FILL/UNDO/SEND handlers
- `src/lib/autopilot.ts` - DOM coverage scoring
- `src/lib/tab-manager.ts` - Multi-tab session management
- `src/lib/supabase.ts` - Database operations
- `src/lib/ws-bridge.ts` - Feed A-E multiplexer
- `src/audio/deepgram-consumer.ts` - Deepgram integration
- `src/audio/chunk-assembler.ts` - Word-to-chunk aggregation

**HTTP Endpoints:**
```
GET  /health              - System health + feed status
GET  /demo/patient        - Generate ephemeral patient code
POST /dom                 - Bind DOM map to transcript
GET  /patient/current     - Get latest transcript for user
GET  /transcripts/:id     - Get specific transcript
GET  /autopilot/:tabId    - Get autopilot coverage report
GET  /tabs                - List connected browser tabs
```

**WebSocket Messages:**
```
Client → Server:
  hello, bind_audio, force_bind
  start_recording, stop_recording
  command, dom_map, ping

Server → Client:
  connected, hello_ack, audio_bound
  recording_started, recording_stopped
  transcript, autopilot, active_tab_changed
  command_result, dom_map_ack, error, pong
```

### 3. Dashboard (ghost/dashboard/)

**Purpose:** Control center for monitoring and quick actions.

**Features:**
- Feed A-E status tiles
- Real-time transcript viewer
- Autopilot score display
- Connected tabs list
- Quick action buttons

### 4. Database (ghost/supabase/)

**Single Table:** `transcripts2`

```sql
CREATE TABLE transcripts2 (
  id BIGINT PRIMARY KEY,
  user_id UUID NOT NULL,
  patient_code TEXT,
  patient_uuid UUID,
  transcript TEXT,
  transcript_chunk JSONB[],
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  ai_summary JSONB,
  metadata JSONB
);
```

## Data Flow Paths

### PATH A: Audio → Transcript
```
Overlay → Audio Capture (16kHz PCM)
       → WebSocket (binary)
       → Backend
       → DeepgramConsumer
       → ChunkAssembler
       → Supabase (transcripts2)
       → WsBridge (Feed A broadcast)
       → Overlay (transcript display)
```

### PATH B: DOM Mapping
```
Overlay → domMapper.scan()
       → fields[], patientHint
       → WebSocket (dom_map)
       → Backend
       → TabManager.updateDomMap()
       → CommandRouter.updateDomMap()
       → Autopilot.calculateCoverage()
       → WebSocket (dom_map_ack + autopilot)
       → Overlay (autopilot pill update)
```

### PATH C: Smart Fill
```
Overlay → FILL button
       → WebSocket (command: fill)
       → Backend/CommandRouter
       → generateFillSteps()
       → WebSocket (command_result + tasks)
       → Overlay/SmartFillEngine
       → Execute steps on DOM
       → State Machine (FILL_COMPLETE)
```

### PATH D: Multi-Tab Session
```
Tab Opens → content.js loads
         → WebSocket connect
         → hello message (tabId, url, patientHint)
         → Backend/TabManager.registerTab()
         → hello_ack (current active tab)

Record Button → bind_audio message
             → TabManager.bindAudio()
             → (if patient mismatch) → warning
             → (else) → audio_bound
             → active_tab_changed (broadcast)
```

## Feed A-E Model

| Feed | Purpose | Status |
|------|---------|--------|
| A | Deepgram Transcription | Implemented |
| B | Voice Concierge | Placeholder |
| C | Emergency Alerts | Placeholder |
| D | Patient Summary | Placeholder |
| E | Compliance Audit | Placeholder |

## State Machine

```
idle ──CONNECT──► connecting ──CONNECTED──► idle
                                           │
                      ┌────────────────────┘
                      ▼
idle ──START_RECORD──► recording ──START_MAP──► mapping
  │                        │                      │
  │                        │ STOP_RECORD          │ MAP_COMPLETE
  │                        ▼                      ▼
  │                      idle ◄───────────── recording
  │                                              │
  │                                              │ START_FILL
  │                                              ▼
  │                                          filling
  │                                              │
  │                      ┌───────── UNDO ────────┤
  │                      ▼                       │ FILL_COMPLETE
  │                  mapping ◄──────────────┐    ▼
  │                                         │ reviewing
  │                                         │    │
  │                                 UNDO ───┤    │ CONFIRM
  │                                         │    ▼
  └──────────── RESET ◄─────────────────────┴── done

error ──DISMISS_ERROR/RESET──► idle
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Extension | TypeScript, Chrome MV3, Shadow DOM, Web Audio API |
| Backend | Node.js, Express, WebSocket, TypeScript |
| Dashboard | Next.js 14, React 18, TypeScript |
| Database | Supabase (PostgreSQL), Row-Level Security |
| Speech-to-Text | Deepgram Nova-2 Medical (diarization) |
| Build | esbuild (extension), tsc (backend), Next.js |

## Environment Variables

```bash
# Backend (.env)
PORT=3001
DEEPGRAM_API_KEY=<key>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role>
DEMO_DOCTOR_ID=00000000-0000-0000-0000-000000000000
```

## Running the System

```bash
# Start Backend
cd ghost/backend
npm install
npm run dev

# Build Extension
cd ghost/extension
npm install
npm run build

# Load in Chrome:
# 1. chrome://extensions
# 2. Enable Developer Mode
# 3. Load Unpacked → ghost/extension/

# Start Dashboard (optional)
cd ghost/dashboard
npm install
npm run dev
```
