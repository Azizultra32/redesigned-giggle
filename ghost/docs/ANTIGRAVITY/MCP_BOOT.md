# MCP Boot Sequence

## Overview

MCP (Model Context Protocol) boot sequence for launching Chrome with the GHOST-NEXT extension in a controlled development environment.

---

## Boot Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│                     MCP BOOT SEQUENCE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. PRE-FLIGHT CHECKS                                          │
│     ├── Verify Node.js version (≥18)                           │
│     ├── Verify backend dependencies installed                  │
│     ├── Verify extension dependencies installed                │
│     └── Check environment variables                            │
│                                                                 │
│  2. BUILD EXTENSION                                            │
│     ├── Run esbuild bundler                                    │
│     ├── Generate dist/content.js                               │
│     ├── Generate dist/background.js                            │
│     └── Verify build success                                   │
│                                                                 │
│  3. START BACKEND                                              │
│     ├── Load .env configuration                                │
│     ├── Initialize Express server                              │
│     ├── Setup WebSocket server                                 │
│     └── Verify health endpoint                                 │
│                                                                 │
│  4. LAUNCH CHROME                                              │
│     ├── Kill existing instances                                │
│     ├── Create/reuse profile directory                         │
│     ├── Load extension from source                             │
│     └── Open default URL                                       │
│                                                                 │
│  5. VERIFY EXTENSION                                           │
│     ├── Check extension loaded                                 │
│     ├── Verify service worker active                           │
│     ├── Test content script injection                          │
│     └── Confirm overlay renders                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Start MCP Script

### scripts/start-mcp.sh

```bash
#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════════"
echo "                  GHOST-NEXT MCP BOOT                       "
echo "═══════════════════════════════════════════════════════════"

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_DIR="/tmp/ghost-chrome-profile"
EXTENSION_DIR="$ROOT_DIR/extension"
BACKEND_DIR="$ROOT_DIR/backend"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

check() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $1"
  else
    echo -e "${RED}✗${NC} $1"
    exit 1
  fi
}

# 1. Pre-flight checks
echo ""
echo "▶ Pre-flight checks..."

node --version >/dev/null 2>&1
check "Node.js installed"

[ -f "$EXTENSION_DIR/package.json" ]
check "Extension package.json exists"

[ -f "$BACKEND_DIR/package.json" ]
check "Backend package.json exists"

# 2. Build extension
echo ""
echo "▶ Building extension..."

cd "$EXTENSION_DIR"
npm run build >/dev/null 2>&1
check "Extension built"

[ -f "$EXTENSION_DIR/dist/content.js" ]
check "content.js generated"

[ -f "$EXTENSION_DIR/dist/background.js" ]
check "background.js generated"

# 3. Check backend (don't start - user should start separately)
echo ""
echo "▶ Checking backend..."

if curl -s http://localhost:3001/health >/dev/null 2>&1; then
  check "Backend running"
else
  echo -e "${RED}!${NC} Backend not running. Start with: cd backend && npm run dev"
fi

# 4. Launch Chrome
echo ""
echo "▶ Launching Chrome..."

# Kill existing Chrome with our profile
pkill -f "user-data-dir=$PROFILE_DIR" 2>/dev/null || true
sleep 1

# Chrome executable (try common paths)
CHROME=""
for path in \
  "/usr/bin/google-chrome" \
  "/usr/bin/chromium" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$(which google-chrome 2>/dev/null)" \
  "$(which chromium 2>/dev/null)"
do
  if [ -x "$path" ]; then
    CHROME="$path"
    break
  fi
done

if [ -z "$CHROME" ]; then
  echo -e "${RED}✗${NC} Chrome not found"
  exit 1
fi

check "Chrome found at $CHROME"

# Launch Chrome
"$CHROME" \
  --load-extension="$EXTENSION_DIR" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --disable-default-apps \
  "http://localhost:3000" &

sleep 2
check "Chrome launched"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  MCP Boot Complete!"
echo ""
echo "  Extension loaded from: $EXTENSION_DIR"
echo "  Chrome profile: $PROFILE_DIR"
echo ""
echo "  Next steps:"
echo "  1. Verify extension in chrome://extensions/"
echo "  2. Test overlay with Alt+G"
echo "  3. Start recording"
echo "═══════════════════════════════════════════════════════════"
```

---

## Troubleshooting Boot Issues

### Extension Not Loading

**Symptom:** Extension doesn't appear in chrome://extensions/

**Causes & Fixes:**
1. Build failed → Check `npm run build` output
2. Invalid manifest → Validate JSON syntax
3. Wrong path → Verify `--load-extension` path

### Service Worker Not Active

**Symptom:** "Service Worker: Inactive" in extensions page

**This is normal!** Chrome suspends idle service workers. The worker activates on:
- Extension icon click
- Page navigation (content script)
- Incoming message

### Content Script Not Injecting

**Symptom:** Overlay doesn't appear on pages

**Causes & Fixes:**
1. Wrong URL pattern → Check `manifest.json` matches
2. Page loaded before extension → Refresh the page
3. CSP blocking → Check console for CSP errors

### WebSocket Connection Failed

**Symptom:** "Offline" pill, connection errors

**Causes & Fixes:**
1. Backend not running → Start with `npm run dev`
2. Wrong port → Verify PORT=3001
3. Firewall blocking → Check localhost:3001 accessible

---

## Chrome Flags Reference

| Flag | Purpose |
|------|---------|
| `--load-extension=PATH` | Load unpacked extension |
| `--user-data-dir=PATH` | Use specific profile |
| `--no-first-run` | Skip first-run wizard |
| `--disable-default-apps` | No default apps |
| `--auto-open-devtools-for-tabs` | Auto-open DevTools |
| `--disable-extensions-except=PATH` | Only allow specific extension |

---

## Profile Management

### Create Fresh Profile

```bash
rm -rf /tmp/ghost-chrome-profile
./scripts/start-mcp.sh
```

### Preserve Profile Between Sessions

The profile persists at `/tmp/ghost-chrome-profile`. To keep settings:
- Don't delete the directory
- Extension stays loaded
- Permissions remembered

### Reset Permissions

```bash
rm -rf /tmp/ghost-chrome-profile/Default/Preferences
```
