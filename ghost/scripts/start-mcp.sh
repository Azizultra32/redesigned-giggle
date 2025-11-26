#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════════"
echo "        AssistMD Truth Package - MCP BOOT                   "
echo "═══════════════════════════════════════════════════════════"

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_DIR="/tmp/assistmd-chrome-profile"
EXTENSION_DIR="$ROOT_DIR/apps/overlay"
BACKEND_DIR="$ROOT_DIR/apps/cns-agent"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $1"
  else
    echo -e "${RED}✗${NC} $1"
    exit 1
  fi
}

warn() {
  echo -e "${YELLOW}!${NC} $1"
}

# 1. Pre-flight checks
echo ""
echo "▶ Pre-flight checks..."

node --version >/dev/null 2>&1
check "Node.js installed"

[ -f "$EXTENSION_DIR/package.json" ]
check "Extension package.json exists"

# 2. Build extension
echo ""
echo "▶ Building extension..."

cd "$EXTENSION_DIR"
if npm run build >/dev/null 2>&1; then
  check "Extension built"
else
  echo -e "${RED}✗${NC} Extension build failed"
  exit 1
fi

[ -f "$EXTENSION_DIR/content.js" ]
check "content.js exists"

# 3. Check backend
echo ""
echo "▶ Checking backend..."

if curl -s http://localhost:3001/health >/dev/null 2>&1; then
  check "Backend running on port 3001"
else
  warn "Backend not running. Starting backend..."
  cd "$BACKEND_DIR"
  npm run dev > /tmp/cns-agent.log 2>&1 &
  sleep 3
  if curl -s http://localhost:3001/health >/dev/null 2>&1; then
    check "Backend started successfully"
  else
    warn "Backend failed to start. Check /tmp/cns-agent.log"
  fi
fi

# 4. Launch Chrome
echo ""
echo "▶ Launching Chrome..."

# Kill existing Chrome with our profile
pkill -f "user-data-dir=$PROFILE_DIR" 2>/dev/null || true
sleep 1

# Find Chrome
CHROME=""
for path in \
  "/usr/bin/google-chrome" \
  "/usr/bin/google-chrome-stable" \
  "/usr/bin/chromium" \
  "/usr/bin/chromium-browser" \
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

check "Chrome found"

# Launch
"$CHROME" \
  --load-extension="$EXTENSION_DIR" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --disable-default-apps \
  "http://localhost:3000" 2>/dev/null &

sleep 2
check "Chrome launched"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  MCP Boot Complete!"
echo ""
echo "  Extension: $EXTENSION_DIR"
echo "  Profile:   $PROFILE_DIR"
echo ""
echo "  Shortcuts:"
echo "    Alt+G  - Toggle overlay"
echo "    Alt+R  - Start/stop recording"
echo "═══════════════════════════════════════════════════════════"
