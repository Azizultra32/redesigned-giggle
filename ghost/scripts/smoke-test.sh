#!/bin/bash

echo "═══════════════════════════════════════════════════════════"
echo "              GHOST-NEXT Smoke Test                         "
echo "═══════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

echo ""
echo "▶ Checking services..."
echo ""

# Backend health
echo -n "Backend server... "
if curl -s http://localhost:3001/health | grep -q '"status"'; then
  pass "Running on port 3001"
else
  fail "Not running (start with: cd backend && npm run dev)"
fi

# Deepgram key
echo -n "Deepgram API key... "
if [ -n "$DEEPGRAM_API_KEY" ]; then
  pass "Set in environment"
elif [ -f "$ROOT_DIR/backend/.env" ] && grep -q "DEEPGRAM_API_KEY=" "$ROOT_DIR/backend/.env"; then
  pass "Set in .env"
else
  warn "Not configured (transcription won't work)"
fi

# Supabase
echo -n "Supabase config... "
if [ -n "$SUPABASE_URL" ]; then
  pass "URL set in environment"
elif [ -f "$ROOT_DIR/backend/.env" ] && grep -q "SUPABASE_URL=" "$ROOT_DIR/backend/.env"; then
  pass "URL set in .env"
else
  warn "Not configured (offline mode)"
fi

echo ""
echo "▶ Checking extension..."
echo ""

# Extension files
echo -n "Content script... "
if [ -f "$ROOT_DIR/extension/content.js" ]; then
  pass "content.js exists"
else
  fail "Missing content.js"
fi

echo -n "Background script... "
if [ -f "$ROOT_DIR/extension/background.js" ]; then
  pass "background.js exists"
else
  fail "Missing background.js"
fi

echo -n "Overlay module... "
if [ -f "$ROOT_DIR/extension/overlay.js" ]; then
  pass "overlay.js exists"
else
  fail "Missing overlay.js"
fi

echo -n "Manifest... "
if [ -f "$ROOT_DIR/extension/manifest.json" ]; then
  pass "manifest.json exists"
else
  fail "Missing manifest.json"
fi

echo ""
echo "▶ Checking documentation..."
echo ""

# Docs
echo -n "Architecture docs... "
if [ -d "$ROOT_DIR/docs/architecture" ] && [ "$(ls -A $ROOT_DIR/docs/architecture)" ]; then
  pass "Present"
else
  fail "Missing"
fi

echo -n "Workflow docs... "
if [ -d "$ROOT_DIR/docs/workflows" ] && [ "$(ls -A $ROOT_DIR/docs/workflows)" ]; then
  pass "Present"
else
  fail "Missing"
fi

echo -n "Spec docs... "
if [ -d "$ROOT_DIR/docs/specs" ] && [ "$(ls -A $ROOT_DIR/docs/specs)" ]; then
  pass "Present"
else
  fail "Missing"
fi

echo -n "TRUTH_PACKAGE.md... "
if [ -f "$ROOT_DIR/docs/TRUTH_PACKAGE.md" ]; then
  pass "Present"
else
  fail "Missing"
fi

echo -n "Supabase schemas... "
if [ -f "$ROOT_DIR/supabase/transcripts2-schema.sql" ]; then
  pass "Present"
else
  fail "Missing"
fi

echo ""
echo "▶ Checking profile..."
echo ""

PROFILE_DIR="/tmp/ghost-chrome-profile"
echo -n "Chrome profile... "
if [ -d "$PROFILE_DIR" ]; then
  pass "Exists at $PROFILE_DIR"
else
  warn "Not created (run start-mcp.sh)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Smoke Test Complete"
echo "═══════════════════════════════════════════════════════════"
