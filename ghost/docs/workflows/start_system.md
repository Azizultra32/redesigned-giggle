# Start System Workflow

## Prerequisites

1. Node.js 18+ installed
2. Deepgram API key
3. Supabase project with transcripts2 table
4. Chrome browser

## Step 1: Configure Environment

### Backend

Create `backend/.env`:

```bash
PORT=3001
DEEPGRAM_API_KEY=your_deepgram_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Get Deepgram API Key:**
1. Go to https://console.deepgram.com
2. Create project or select existing
3. Create API key with "Usage" scope

**Get Supabase Credentials:**
1. Go to https://supabase.com/dashboard
2. Select project
3. Settings → API
4. Copy URL and service_role key (NOT anon key)

## Step 2: Install Dependencies

```bash
# Backend
cd backend
npm install

# Extension (if using TypeScript build)
cd ../extension
npm install
```

## Step 3: Start Backend Server

```bash
cd backend
npm run dev
```

Expected output:
```
========================================
   GHOST-NEXT Backend Server
========================================
   Port:      3001
   WebSocket: ws://localhost:3001/ws
   Health:    http://localhost:3001/health
   Demo:      http://localhost:3001/demo/patient
========================================
```

### Verify Backend

```bash
curl http://localhost:3001/health
```

Expected:
```json
{"status":"ok","timestamp":"2024-01-15T10:00:00.000Z","version":"1.0.0"}
```

## Step 4: Load Extension in Chrome

### Option A: Manual Load

1. Open Chrome
2. Go to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `extension/` folder

### Option B: Using Script

```bash
./scripts/start-mcp.sh
```

This launches Chrome with:
- Dedicated profile (no interference with main browser)
- Extension pre-loaded
- Developer mode enabled

## Step 5: Test the System

1. Navigate to any webpage
2. Look for GHOST overlay (bottom-right corner)
3. Click record button
4. Speak into microphone
5. See transcript appear in overlay

## Verification Checklist

- [ ] Backend running on port 3001
- [ ] Health endpoint returns `status: ok`
- [ ] Extension visible in Chrome
- [ ] Overlay appears on pages
- [ ] WebSocket connects (status shows "Connected")
- [ ] Microphone permission granted
- [ ] Audio streams to backend
- [ ] Transcripts appear in overlay

## Troubleshooting

### Backend won't start

```bash
# Check if port is in use
lsof -i :3001

# Kill existing process
kill -9 <PID>
```

### Extension won't load

1. Check `manifest.json` for syntax errors
2. Verify all referenced files exist
3. Check Chrome DevTools for extension errors

### No transcripts appearing

1. Check backend logs for Deepgram errors
2. Verify `DEEPGRAM_API_KEY` is set correctly
3. Test Deepgram key with:
   ```bash
   curl -X POST "https://api.deepgram.com/v1/listen" \
     -H "Authorization: Token YOUR_API_KEY" \
     -H "Content-Type: audio/wav" \
     --data-binary @test.wav
   ```

### Chunks not saving to Supabase

1. Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
2. Check Supabase logs in dashboard
3. Verify `transcripts2` table exists with correct schema

## Quick Start Script

Create `start.sh`:

```bash
#!/bin/bash

# Start backend in background
cd backend
npm run dev &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 3

# Start Chrome with extension
cd ..
./scripts/start-mcp.sh

# Cleanup on exit
trap "kill $BACKEND_PID" EXIT
wait
```

Run: `./start.sh`
