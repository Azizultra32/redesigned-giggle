# AntiGravity Playbook

## Overview

AntiGravity is the operational framework for developing and testing GHOST-NEXT. This playbook provides step-by-step instructions for common development tasks.

---

## Daily Startup Sequence

### 1. Start Backend Server

```bash
cd backend
npm run dev
```

Expected output:
```
🚀 GHOST-NEXT Agent running on port 3001
   WebSocket: ws://localhost:3001/ws
   Health: http://localhost:3001/health
```

### 2. Build Extension

```bash
cd extension
npm run build
```

Expected output:
```
🏎️  Building GHOST-NEXT Extension...
📦 Building content...
✅ content built successfully
📦 Building background...
✅ background built successfully
🏁 Build complete!
```

### 3. Launch Chrome with MCP

```bash
./scripts/start-mcp.sh
```

### 4. Verify Everything

```bash
./scripts/smoke-test.sh
```

All checks should show ✓

---

## Recording Session Workflow

### Start Recording

1. Navigate to any web page
2. Press `Alt+G` to show overlay (if hidden)
3. Click **Record** button
4. Grant microphone permission if prompted
5. Speak clearly
6. Watch transcript appear in real-time

### Stop Recording

1. Click **Stop** button
2. Transcript stops updating
3. Session saved to Supabase (if configured)

### Clear Transcript

1. Click trash icon button
2. Transcript cleared
3. Does not delete from database

---

## Field Mapping Workflow

### Detect Fields

1. Navigate to page with form fields
2. Click **Map** button (target icon)
3. Switch to **Mapping** tab
4. View detected fields with categories

### Send to Field

1. Select text in transcript
2. Find target field in mapping list
3. Click **Send** next to field
4. Text injected into form field

---

## Development Workflows

### Making Backend Changes

1. Edit files in `backend/src/`
2. Server auto-restarts (tsx watch)
3. Test changes immediately

### Making Extension Changes

1. Edit files in `extension/src/`
2. Run `npm run build` (or `npm run watch`)
3. Go to `chrome://extensions/`
4. Click reload button on extension
5. Refresh target page

### Watch Mode Development

Terminal 1 (Backend):
```bash
cd backend && npm run dev
```

Terminal 2 (Extension):
```bash
cd extension && npm run watch
```

Terminal 3 (Chrome):
```bash
./scripts/start-mcp.sh
```

---

## Debugging Procedures

### Backend Debugging

1. Check console output for errors
2. Verify Deepgram connection:
   ```
   [Deepgram] Connected
   ```
3. Verify WebSocket connections:
   ```
   [Server] New WebSocket connection
   ```

### Extension Debugging

1. Open `chrome://extensions/`
2. Click "Service Worker" to debug background
3. Open page DevTools for content script
4. Check console for:
   ```
   [GHOST-NEXT] Ferrari Overlay initialized successfully
   ```

### WebSocket Debugging

1. DevTools → Network → WS filter
2. Click WebSocket connection
3. View Messages tab
4. Binary = audio, Text = JSON events

---

## Common Tasks

### Reset Chrome Profile

```bash
rm -rf /tmp/ghost-chrome-profile
./scripts/start-mcp.sh
```

### Clear Supabase Test Data

```sql
DELETE FROM transcript_chunks WHERE transcript_id IN (
  SELECT id FROM transcripts2 WHERE provider_id = 'test'
);
DELETE FROM transcripts2 WHERE provider_id = 'test';
```

### Test Deepgram Connectivity

```bash
curl -X POST "https://api.deepgram.com/v1/listen" \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @test-audio.wav
```

### Check Backend Health

```bash
curl http://localhost:3001/health | jq
```

---

## Checklist: Before Each Session

- [ ] Backend server running (`npm run dev`)
- [ ] Extension built (`npm run build`)
- [ ] Chrome launched with extension
- [ ] Smoke test passing
- [ ] DevTools open for debugging

## Checklist: Before Commit

- [ ] All TypeScript compiles (`npm run typecheck`)
- [ ] Extension builds without errors
- [ ] Basic recording test works
- [ ] No console errors in browser
- [ ] Sensitive data not in code

---

## Environment Setup

### Required Environment Variables

Create `backend/.env`:
```env
PORT=3001
DEEPGRAM_API_KEY=your_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key_here
NODE_ENV=development
```

### Optional: Local Development Without Supabase

If no Supabase configured:
- Backend runs in "offline mode"
- Transcripts not persisted
- All other features work

---

## Quick Reference

| Task | Command |
|------|---------|
| Start backend | `cd backend && npm run dev` |
| Build extension | `cd extension && npm run build` |
| Watch extension | `cd extension && npm run watch` |
| Launch Chrome | `./scripts/start-mcp.sh` |
| Smoke test | `./scripts/smoke-test.sh` |
| Reset profile | `rm -rf /tmp/ghost-chrome-profile` |
| Type check backend | `cd backend && npm run typecheck` |
| Type check extension | `cd extension && npm run typecheck` |
