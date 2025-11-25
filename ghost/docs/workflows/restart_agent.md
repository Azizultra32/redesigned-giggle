# Restart Agent Workflow

## When to Restart

Restart the backend agent when:

1. Environment variables changed
2. Code changes made (if not using hot reload)
3. Memory issues
4. Connection stuck
5. After updating dependencies

## Method 1: Graceful Restart (Recommended)

### Step 1: Stop Recording

If a recording is in progress:

1. Click stop button in overlay
2. Wait for "Recording stopped" message
3. Verify chunks saved in Supabase

### Step 2: Stop Backend

```bash
# If running in foreground
Ctrl+C

# If running in background
# Find process
ps aux | grep "node.*server"
# or
lsof -i :3001

# Kill gracefully
kill <PID>

# Force kill if needed
kill -9 <PID>
```

### Step 3: Start Backend

```bash
cd backend
npm run dev
```

### Step 4: Reconnect Extension

The extension auto-reconnects. If not:

1. Reload the page
2. Or: Click extension icon to toggle

## Method 2: Hot Reload (Development)

The `npm run dev` command uses `tsx watch` which auto-restarts on file changes.

When you save a `.ts` file:
```
[tsx] Restarting...
========================================
   GHOST-NEXT Backend Server
========================================
```

**Note:** Active WebSocket connections will be dropped. Extension will reconnect automatically.

## Method 3: Full Reset

For clean slate:

```bash
# Stop everything
pkill -f "node.*server"
pkill -f "Chrome.*ghost"

# Clear state
rm -rf backend/dist
rm -rf .chrome-profile

# Reinstall
cd backend && npm install

# Start fresh
npm run dev
```

## Preserving State

### Active Transcripts

Before restart, note any active `transcriptId`:

```javascript
// In extension console
console.log(window.__ghostState?.transcriptId);
```

After restart, the extension creates a new session. Old transcripts remain in Supabase.

### Pending Chunks

If chunks are pending when server stops:

1. They're lost (not persisted to Supabase yet)
2. Check `pendingChunks` queue size before restart
3. Consider implementing local backup

## Health Check After Restart

```bash
# Check backend
curl http://localhost:3001/health

# Check stats
curl http://localhost:3001/stats
```

Expected:
```json
{
  "activeSessions": 0,
  "uptime": 5.123,
  "memory": {...}
}
```

## Automated Restart Script

Create `scripts/restart-agent.sh`:

```bash
#!/bin/bash

echo "Stopping backend..."
pkill -f "tsx.*server" || true
sleep 2

echo "Starting backend..."
cd backend
npm run dev &

echo "Waiting for startup..."
sleep 3

# Health check
if curl -s http://localhost:3001/health | grep -q "ok"; then
  echo "Backend restarted successfully"
else
  echo "ERROR: Backend health check failed"
  exit 1
fi
```

## PM2 Process Manager (Production)

For production deployments:

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start backend/dist/server.js --name ghost-backend

# Restart
pm2 restart ghost-backend

# Logs
pm2 logs ghost-backend

# Monitor
pm2 monit
```

## Troubleshooting

### Port already in use

```bash
# Find and kill
lsof -ti :3001 | xargs kill -9

# Or use different port
PORT=3002 npm run dev
```

### Extension shows "Disconnected"

1. Wait 3-5 seconds for auto-reconnect
2. If still disconnected, reload page
3. Check backend is actually running

### Database connections hanging

```bash
# Restart with clean Supabase client
rm -rf node_modules/.cache
npm run dev
```
