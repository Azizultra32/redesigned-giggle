# Autopilot Specification

## Overview

Autopilot mode enables AI-assisted development and testing of the GHOST-NEXT system. This specification defines how autonomous agents can interact with the system.

## Capabilities

### 1. Code Generation

Autopilot can generate:
- TypeScript/JavaScript code
- Documentation files
- Configuration files
- Test scripts

### 2. Code Modification

Autopilot can modify existing files:
- Add features
- Fix bugs
- Refactor code
- Update dependencies

### 3. System Testing

Autopilot can test:
- Backend health
- WebSocket connectivity
- Deepgram integration
- Supabase operations

## Entry Points

### Backend

```bash
# Start server
cd backend && npm run dev

# Verify health
curl http://localhost:3001/health
```

### Extension

```bash
# Load in Chrome
./scripts/start-mcp.sh

# Or manually:
# chrome://extensions → Load unpacked → extension/
```

### Supabase

```bash
# Run schema
psql $DATABASE_URL < supabase/transcripts2-schema.sql
```

## Verification Commands

### Check Backend Running

```bash
curl -s http://localhost:3001/health | jq .status
# Expected: "ok"
```

### Check TypeScript

```bash
cd backend && npm run typecheck
# Expected: No errors
```

### Check Extension

```bash
# In Chrome DevTools console
document.getElementById('ghost-overlay-root') !== null
# Expected: true
```

## Test Scenarios

### Scenario 1: Basic Recording

1. Start backend
2. Load extension in Chrome
3. Navigate to test page
4. Click record
5. Speak test phrase
6. Click stop
7. Verify transcript in overlay

### Scenario 2: Patient Info

1. Start recording
2. Set patient code via overlay
3. Stop recording
4. Query Supabase for transcript
5. Verify patient_code field

### Scenario 3: Chunk Storage

1. Start recording
2. Speak for 30+ seconds
3. Verify multiple chunks created
4. Check speaker diarization
5. Stop recording
6. Query transcript_chunk array

## Autopilot Guidelines

### Safe Operations

- Read files
- Write new files
- Modify existing files (with backup)
- Run tests
- Query databases (read)
- Start/stop servers

### Requires Confirmation

- Delete files
- Database writes
- Push to git
- Deploy to production
- Modify credentials

### Prohibited

- Access external systems without permission
- Store credentials in code
- Make breaking changes without tests
- Skip validation steps

## MCP Integration

### Available Tools

- File read/write
- Bash commands
- Web fetch
- Browser control (puppeteer)

### Example Workflow

```typescript
// 1. Read current implementation
const serverCode = await read('backend/server.ts');

// 2. Make modifications
const updatedCode = modifyCode(serverCode, changes);

// 3. Write changes
await write('backend/server.ts', updatedCode);

// 4. Verify compilation
await bash('cd backend && npm run typecheck');

// 5. Test functionality
await bash('curl http://localhost:3001/health');
```

## Error Recovery

If autopilot encounters errors:

1. **Compilation Error**
   - Read error message
   - Identify problematic code
   - Fix syntax/type issues
   - Re-verify

2. **Runtime Error**
   - Check logs
   - Identify root cause
   - Apply fix
   - Restart server

3. **Test Failure**
   - Review expected vs actual
   - Adjust implementation
   - Re-run tests

## Progress Tracking

Use TodoWrite for multi-step tasks:

```typescript
await todoWrite([
  { content: 'Update server.ts', status: 'completed' },
  { content: 'Fix type errors', status: 'in_progress' },
  { content: 'Run tests', status: 'pending' },
  { content: 'Commit changes', status: 'pending' }
]);
```

## Communication

Autopilot should:
- Explain actions before taking them
- Report progress clearly
- Ask for clarification when needed
- Summarize completed work
