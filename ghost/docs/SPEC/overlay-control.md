# Overlay Control Specification

## Overview

The Ferrari Overlay is a Shadow DOM-based UI injected into web pages for voice-controlled clinical documentation.

---

## UI State Machine

```
                    ┌─────────────┐
                    │    IDLE     │
                    │ (not rec)   │
                    └──────┬──────┘
                           │ click Record
                           ▼
                    ┌─────────────┐
         ┌─────────│  CONNECTING │
         │         │  (spinner)  │
         │         └──────┬──────┘
         │                │ ws connected
         │                ▼
         │         ┌─────────────┐
         │         │  RECORDING  │◄────────┐
         │         │  (red dot)  │         │
         │         └──────┬──────┘         │
         │                │                │
         │    ┌───────────┼───────────┐    │
         │    │           │           │    │
         │    ▼           ▼           ▼    │
         │ click Stop  ws error   auto-pause
         │    │           │           │    │
         │    │           │           │    │
         │    ▼           ▼           │    │
         │ ┌─────────────────────┐    │    │
         │ │      STOPPED       │    │    │
         │ │  (show transcript) │────┼────┘
         │ └─────────────────────┘  resume
         │
         │ connection failed
         ▼
    ┌─────────────┐
    │    ERROR    │
    │ (retry btn) │
    └─────────────┘
```

---

## Component Hierarchy

```
FerrariOverlay (Shadow DOM root)
├── Header
│   ├── Logo + Title
│   ├── StatusPills
│   │   ├── ConnectionPill (online/offline)
│   │   ├── RecordingPill (REC indicator)
│   │   └── PatientPill (name/MRN)
│   └── MinimizeButton
├── TabBar
│   ├── TranscriptTab
│   ├── MappingTab
│   └── SettingsTab
├── ContentArea
│   ├── TranscriptPanel
│   │   ├── SpeakerGroup[]
│   │   │   ├── SpeakerBadge
│   │   │   └── TranscriptLine[]
│   │   └── EmptyState
│   ├── MappingPanel
│   │   └── FieldList[]
│   └── SettingsPanel
└── ControlBar
    ├── RecordButton / StopButton
    ├── MapButton
    └── ClearButton
```

---

## Recording Controls

### Start Recording
1. User clicks Record button
2. Request microphone permission
3. Initialize AudioContext (16kHz, mono)
4. Connect WebSocket to `/ws`
5. Start streaming PCM audio
6. Update UI to RECORDING state
7. Show pulsing REC pill

### Stop Recording
1. User clicks Stop button
2. Stop AudioContext
3. Send `stop` message on WebSocket
4. Close WebSocket connection
5. Update UI to STOPPED state
6. Keep transcript visible

### Error Recovery
1. On WebSocket error → show ERROR state
2. Display retry button
3. On retry → attempt reconnect (max 3 times)
4. Exponential backoff: 1s, 2s, 4s

---

## Transcript Display

### Speaker Grouping
- Group consecutive utterances by same speaker
- Show speaker badge with color coding:
  - Speaker 0 (Provider) → Green badge
  - Speaker 1 (Patient) → Blue badge
  - Other → Gray badge

### Real-time Updates
- Interim results shown in italic gray
- Final results replace interim, shown in white
- Auto-scroll to latest (toggleable)
- Timestamp on first line of each group

### Transcript Line Format
```
┌─────────────────────────────────────┐
│ [Provider] 10:32:15 AM              │
│ Hello, how are you feeling today?   │
│ Any changes since your last visit?  │
├─────────────────────────────────────┤
│ [Patient] 10:32:22 AM               │
│ I've been having headaches more     │
│ frequently, maybe three times a     │
│ week now.                           │
└─────────────────────────────────────┘
```

---

## Field Mapping (Autopilot)

### Detection Phase
1. User clicks Map button
2. DOMMapper scans visible form fields
3. Categorize fields by label patterns
4. Display detected fields in MappingPanel

### Field Categories
| Category | Patterns |
|----------|----------|
| `patient_name` | /patient.*name/i, /pt.*name/i |
| `mrn` | /mrn/i, /medical.*record/i |
| `chief_complaint` | /chief.*complaint/i, /cc/i |
| `hpi` | /hpi/i, /history.*present/i |
| `assessment` | /assessment/i, /diagnosis/i |
| `plan` | /plan/i, /treatment/i |

### Mapping Actions
- **Map**: Detect and list fields
- **Send**: Copy selected text to field
- **Smart Fill**: AI-generated content to field
- **Undo**: Revert last field change

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+G` | Toggle overlay visibility |
| `Alt+R` | Start/stop recording |
| `Alt+M` | Map fields |
| `Alt+C` | Clear transcript |
| `Escape` | Minimize overlay |

---

## WebSocket Events (Overlay → Agent)

```typescript
// Start recording session
{ type: 'start', providerId: string, patientCode?: string }

// Stop recording
{ type: 'stop' }

// Audio data (binary)
ArrayBuffer // 16-bit PCM, 16kHz, mono

// Request field mapping
{ type: 'map-fields', fields: DetectedField[] }
```

---

## WebSocket Events (Agent → Overlay)

```typescript
// Connection status
{ type: 'status', status: 'connected' | 'ready' }

// Transcript update
{
  type: 'transcript',
  id: string,
  text: string,
  speaker: string,
  timestamp: number,
  is_final: boolean
}

// Error
{ type: 'error', error: string, code?: string }

// Patient info detected
{ type: 'patient', name: string, mrn: string }
```

---

## Styling Guidelines

### Colors
- Background: `#1a1a2e` (dark navy)
- Header: `#e63946` gradient (Ferrari red)
- Text primary: `#eee`
- Text secondary: `#888`
- Provider badge: `#4caf50`
- Patient badge: `#2196f3`
- Recording: `#ff5252`

### Dimensions
- Width: 380px
- Max height: 600px
- Border radius: 12px
- Z-index: 2147483647 (max)

### Animations
- Fade in: 200ms ease
- Pulse (recording): 1.5s infinite
- Slide (minimize): 150ms ease-out
