# Overlay Specification

## Overview

The Ferrari Overlay is a floating UI injected into web pages via Chrome extension content script.

## Requirements

### Functional

1. **Injection**
   - Inject into all web pages
   - Use Shadow DOM for isolation
   - Z-index above all page content

2. **Recording**
   - Start/stop audio recording
   - Visual recording indicator
   - Microphone permission handling

3. **Transcript Display**
   - Real-time transcript feed
   - Speaker identification (color-coded)
   - Interim vs final distinction
   - Auto-scroll to latest

4. **Patient Info**
   - Patient code input
   - Optional UUID input
   - Save to active transcript

5. **UI Controls**
   - Tab navigation (Recorder/Transcript/Patient)
   - Minimize to icon
   - Draggable positioning

### Non-Functional

1. **Performance**
   - < 50ms injection time
   - < 16ms render updates
   - Minimal memory footprint

2. **Compatibility**
   - Chrome 100+
   - Works on all HTTPS pages
   - No interference with host page

3. **Accessibility**
   - Keyboard navigable
   - Screen reader compatible
   - High contrast text

## UI Specification

### Dimensions

- **Width:** 400px (fixed)
- **Max Height:** 500px
- **Minimized:** 60px × 60px (circle)

### Theme

```css
--primary: #e94560;      /* Ferrari red */
--background: #1a1a2e;   /* Dark blue-black */
--surface: #16213e;      /* Elevated surface */
--border: #0f3460;       /* Border color */
--text: #ffffff;         /* Primary text */
--text-muted: #888888;   /* Secondary text */
--success: #4ade80;      /* Green (Provider) */
--info: #60a5fa;         /* Blue (Patient) */
```

### Components

#### Header
- Title: "GHOST" (primary color)
- Status badge: Connected/Disconnected/Recording
- Minimize button

#### Tabs
- Recorder (default)
- Transcript
- Patient

#### Recorder Panel
- Large record button (80px)
- Recording animation (pulse)
- Status text

#### Transcript Panel
- Scrollable feed
- Transcript items with speaker label
- Color-coded speakers

#### Patient Panel
- Patient code input
- Patient UUID input
- Save button

### States

| State | Visual |
|-------|--------|
| Disconnected | Gray status badge |
| Connected | Green status badge |
| Recording | Red status badge + animation |
| Minimized | Circle icon only |

## Interaction Specification

### Recording Flow

1. User clicks record button
2. Request microphone permission (if needed)
3. Start AudioContext + capture
4. Send `start_recording` to backend
5. Stream audio via WebSocket
6. Display incoming transcripts
7. User clicks stop
8. Stop AudioContext
9. Send `stop_recording` to backend

### Tab Switching

1. Click tab button
2. Remove `active` from all tabs/panels
3. Add `active` to clicked tab/panel
4. No data loss between switches

### Minimize/Expand

1. Click minimize → overlay collapses to icon
2. Click icon → overlay expands
3. Position preserved

### Dragging

1. Mousedown on header → start drag
2. Mousemove → update position
3. Mouseup → end drag
4. Position persists within session

## Technical Specification

### Shadow DOM Structure

```html
<div id="ghost-overlay-root">
  #shadow-root (closed)
    <style>...</style>
    <div class="ghost-overlay">
      <div class="header">...</div>
      <div class="tabs">...</div>
      <div class="overlay-content">
        <div class="tab-content" data-tab="recorder">...</div>
        <div class="tab-content" data-tab="transcript">...</div>
        <div class="tab-content" data-tab="patient">...</div>
      </div>
    </div>
</div>
```

### Event Handling

All events handled within Shadow DOM:
- Click handlers on buttons
- Input handlers on form fields
- No event bubbling to host page

### WebSocket Communication

See [COMMAND_FLOW.md](../architecture/COMMAND_FLOW.md)

### Audio Capture

- Web Audio API
- ScriptProcessor (deprecated but reliable)
- 16kHz sample rate
- Mono channel
- PCM 16-bit encoding
