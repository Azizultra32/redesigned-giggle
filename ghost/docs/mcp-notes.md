# MCP Notes

## Overview

MCP (Model Context Protocol) is used in GHOST-NEXT for controlled Chrome development environments.

---

## Quick Start

```bash
# Start backend first
cd backend && npm run dev

# Build extension
cd extension && npm run build

# Launch Chrome with MCP
./scripts/start-mcp.sh
```

---

## Chrome Launch Flags

| Flag | Purpose |
|------|---------|
| `--load-extension` | Load unpacked extension |
| `--user-data-dir` | Isolated profile directory |
| `--no-first-run` | Skip Chrome setup wizard |
| `--disable-default-apps` | No default apps |

---

## Profile Location

Default: `/tmp/ghost-chrome-profile`

Contains:
- Extension data
- Permissions granted
- Local storage
- Cookies

**Reset profile:**
```bash
rm -rf /tmp/ghost-chrome-profile
```

---

## Extension Development Workflow

1. Edit source in `extension/src/`
2. Build: `npm run build`
3. Chrome: Click reload button in chrome://extensions/
4. Refresh target page

**Watch mode:**
```bash
npm run watch  # Auto-rebuilds on change
```

---

## Debugging

### Service Worker
- chrome://extensions/ → Service Worker link
- Opens dedicated DevTools

### Content Script
- Open page DevTools (F12)
- Sources → Content scripts

### WebSocket
- DevTools → Network → WS filter
- Click connection to see messages

---

## Common Issues

**Extension not loading:**
- Run `npm run build`
- Check manifest.json syntax

**Service worker inactive:**
- Normal behavior - wakes on events
- Click extension icon to activate

**Content script not injecting:**
- Check manifest matches pattern
- Refresh page after extension reload

---

## Environment Checklist

Before using MCP:

- [ ] Node.js 18+ installed
- [ ] Backend dependencies: `cd backend && npm install`
- [ ] Extension dependencies: `cd extension && npm install`
- [ ] Backend .env configured
- [ ] Chrome/Chromium available

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `start-mcp.sh` | Launch Chrome with extension |
| `smoke-test.sh` | Verify all services |
| `build-extension.mjs` | Build extension |
