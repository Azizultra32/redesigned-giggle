# Overlay System (Ferrari UI)

## Overview

The Ferrari Overlay is a Chrome extension content script that injects a floating UI into web pages for recording and transcript display.

## Architecture

```
extension/
├── content.js      # Main content script (injection point)
├── overlay.js      # Overlay UI components
├── background.js   # Service worker
└── manifest.json   # MV3 manifest
```

## Shadow DOM Isolation

The overlay uses Shadow DOM to isolate styles from host page:

```javascript
const container = document.createElement('div');
container.id = 'ghost-overlay-root';
container.style.cssText = `
  position: fixed;
  top: 0;
  right: 0;
  z-index: 2147483647;
`;

const shadow = container.attachShadow({ mode: 'closed' });
shadow.innerHTML = getOverlayHTML();

document.body.appendChild(container);
```

### Why Shadow DOM?

1. **Style isolation** - No CSS conflicts with host page
2. **DOM isolation** - Host scripts can't interfere
3. **Closed mode** - Host can't access shadow content

## UI Components

### 1. Header

```
┌─────────────────────────────────────────┐
│  GHOST              Connected  [─]      │
└─────────────────────────────────────────┘
```

- Title: "GHOST"
- Status badge: Connected/Disconnected/Recording
- Minimize button

### 2. Tabs

```
┌──────────┬─────────────┬──────────┐
│ Recorder │ Transcript  │ Patient  │
└──────────┴─────────────┴──────────┘
```

Three main views:
- **Recorder**: Start/stop recording
- **Transcript**: Live transcript feed
- **Patient**: Patient info input

### 3. Recorder View

```
         ┌─────────┐
         │   ●     │
         │  START  │
         └─────────┘
    Click to start recording
```

- Large record button
- Recording animation when active
- Status text

### 4. Transcript View

```
┌─────────────────────────────────────────┐
│ Provider                                 │
│ Hello, how are you feeling today?       │
├─────────────────────────────────────────┤
│ Patient                                  │
│ I've been having some headaches lately. │
└─────────────────────────────────────────┘
```

- Scrollable feed
- Color-coded speakers
- Auto-scroll on new content

### 5. Patient View

```
┌─────────────────────────────────────────┐
│ Patient Code (ENC-YYYY-XXXXX)           │
│ ┌─────────────────────────────────────┐ │
│ │ ENC-2024-00001                      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Patient UUID (optional)                 │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│        [  Save Patient Info  ]          │
└─────────────────────────────────────────┘
```

## State Management

```javascript
const state = {
  isMinimized: false,
  isRecording: false,
  isConnected: false,
  activeTab: 'recorder',
  transcripts: []
};
```

## Minimize/Expand

Minimized state shows only a circular icon:

```
    ┌───┐
    │🎙️│   <-- Click to expand
    └───┘
```

## Position Modes

The overlay can be positioned in corners:

```javascript
.position-bottom-right { bottom: 20px; right: 20px; }
.position-bottom-left  { bottom: 20px; left: 20px; }
.position-top-right    { top: 20px; right: 20px; }
.position-top-left     { top: 20px; left: 20px; }
```

## Draggable

Header is draggable for repositioning:

```javascript
function makeDraggable(element, handle) {
  handle.addEventListener('mousedown', (e) => {
    // Start drag
  });

  document.addEventListener('mousemove', (e) => {
    // Update position
  });

  document.addEventListener('mouseup', () => {
    // End drag
  });
}
```

## Audio Capture

### getUserMedia

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    sampleRate: 16000,
    echoCancellation: true,
    noiseSuppression: true
  }
});
```

### AudioContext Processing

```javascript
const audioContext = new AudioContext({ sampleRate: 16000 });
const source = audioContext.createMediaStreamSource(stream);
const processor = audioContext.createScriptProcessor(4096, 1, 1);

processor.onaudioprocess = (event) => {
  const pcm = convertToPCM16(event.inputBuffer.getChannelData(0));
  websocket.send(pcm);
};

source.connect(processor);
processor.connect(audioContext.destination);
```

## WebSocket Communication

### Connect

```javascript
const ws = new WebSocket('ws://localhost:3001/ws?userId=' + userId);
```

### Send Commands

```javascript
// Start recording
ws.send(JSON.stringify({ type: 'start_recording', patientCode }));

// Stop recording
ws.send(JSON.stringify({ type: 'stop_recording' }));

// Send audio (binary)
ws.send(pcmBuffer);
```

### Receive Events

```javascript
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'transcript':
      addTranscriptItem(message);
      break;
    case 'recording_started':
      updateRecordingStatus(true);
      break;
    // ...
  }
};
```

## Theme

Ferrari-inspired dark theme:

```css
:root {
  --primary: #e94560;      /* Ferrari red */
  --background: #1a1a2e;   /* Dark blue-black */
  --surface: #16213e;      /* Slightly lighter */
  --border: #0f3460;       /* Border color */
  --text: #ffffff;         /* White text */
  --text-muted: #888888;   /* Gray text */
  --success: #4ade80;      /* Green (Provider) */
  --info: #60a5fa;         /* Blue (Patient) */
}
```

## Keyboard Shortcuts

(Future enhancement)

- `Alt+G` - Toggle overlay
- `Alt+R` - Start/stop recording
- `Alt+M` - Minimize/expand
