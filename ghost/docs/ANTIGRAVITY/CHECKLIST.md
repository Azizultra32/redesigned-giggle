# Daily Verification Checklist

## Morning Startup

### Environment
- [ ] Terminal open in project root
- [ ] .env file present in `backend/`
- [ ] DEEPGRAM_API_KEY set
- [ ] SUPABASE_URL set (optional)

### Backend
- [ ] `cd backend && npm run dev`
- [ ] See "🚀 GHOST-NEXT Agent running on port 3001"
- [ ] No red errors in console
- [ ] `curl localhost:3001/health` returns OK

### Extension
- [ ] `cd extension && npm run build`
- [ ] Build completes without errors
- [ ] `dist/content.js` exists
- [ ] `dist/background.js` exists

### Chrome
- [ ] `./scripts/start-mcp.sh`
- [ ] Chrome launches
- [ ] No extension errors in `chrome://extensions/`
- [ ] Extension shows "Enabled"

### Overlay
- [ ] Navigate to any webpage
- [ ] Press `Alt+G`
- [ ] Overlay appears
- [ ] Connection pill shows "Online"

---

## Recording Test

### Start Recording
- [ ] Click Record button
- [ ] Microphone permission granted
- [ ] REC pill appears (pulsing)
- [ ] No errors in console

### Transcription
- [ ] Speak into microphone
- [ ] Text appears in transcript
- [ ] Speaker labels correct (Provider/Patient)
- [ ] Text updates in real-time

### Stop Recording
- [ ] Click Stop button
- [ ] Recording stops
- [ ] Transcript preserved
- [ ] Session saved (check Supabase if configured)

---

## Feature Verification

### UI Components
- [ ] Header displays correctly
- [ ] Tabs switch properly
- [ ] Transcript panel scrolls
- [ ] Buttons respond to clicks
- [ ] Pills update state

### Keyboard Shortcuts
- [ ] `Alt+G` toggles overlay
- [ ] `Escape` minimizes (if implemented)

### WebSocket
- [ ] Connection established
- [ ] Audio streams without errors
- [ ] Transcripts received
- [ ] Reconnects on disconnect

---

## Before Commit

### Code Quality
- [ ] `npm run typecheck` passes (backend)
- [ ] `npm run typecheck` passes (extension)
- [ ] No TypeScript errors
- [ ] No console.log left in code (except intentional)

### Build
- [ ] Backend compiles
- [ ] Extension builds
- [ ] No build warnings

### Testing
- [ ] Basic recording works
- [ ] Transcript displays
- [ ] No browser console errors

### Security
- [ ] No API keys in code
- [ ] No secrets in commits
- [ ] .env in .gitignore

---

## Weekly Maintenance

### Dependencies
- [ ] Check for npm updates
- [ ] Review security advisories
- [ ] Update if needed

### Profile Cleanup
- [ ] Clear test transcripts from Supabase
- [ ] Reset Chrome profile if issues

### Documentation
- [ ] Update if features changed
- [ ] Add new troubleshooting notes
- [ ] Review TODOs

---

## Quick Health Check

Run this to verify everything:

```bash
# One-liner health check
echo "Backend:" && curl -s localhost:3001/health | jq -r '.status' && \
echo "Extension:" && ls extension/dist/content.js >/dev/null && echo "built" && \
echo "Profile:" && ls /tmp/ghost-chrome-profile >/dev/null 2>&1 && echo "exists" || echo "none"
```

Expected output:
```
Backend: ok
Extension: built
Profile: exists
```

---

## Issue Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| Backend won't start | Check .env, reinstall deps |
| Extension won't build | `rm -rf node_modules && npm i` |
| Overlay not showing | Refresh page, check console |
| No transcript | Check Deepgram key, backend logs |
| Connection failed | Verify backend running on 3001 |
| Permission denied | Reset Chrome profile |
