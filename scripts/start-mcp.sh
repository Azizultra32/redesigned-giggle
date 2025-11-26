#!/bin/bash
#
# MCP Boot Script (PATH N)
#
# Launches Chrome with extension for MCP automation.
# Usage: ./scripts/start-mcp.sh [target_url]
#

set -e

# Configuration
CHROME_PROFILE="mcp-dev-profile"
CHROME_DATA_DIR="${HOME}/.config/chrome-mcp"
EXTENSION_DIR="$(dirname "$0")/../extension/dist-bundle"
DEBUG_PORT=9222
TARGET_URL="${1:-http://localhost:3000}"

echo "========================================="
echo "  AssistMD MCP Boot"
echo "========================================="

# Kill existing Chrome dev profile
echo "[MCP] Killing existing Chrome instances..."
pkill -f "chrome.*${CHROME_PROFILE}" 2>/dev/null || true
sleep 1

# Build extension if needed
if [ ! -d "$EXTENSION_DIR" ]; then
  echo "[MCP] Building extension..."
  cd "$(dirname "$0")/../extension"
  npm run build 2>/dev/null || node build.mjs
  cd - > /dev/null
fi

# Launch Chrome with debugging
echo "[MCP] Launching Chrome..."
echo "  Profile: ${CHROME_PROFILE}"
echo "  Debug Port: ${DEBUG_PORT}"
echo "  Target: ${TARGET_URL}"

google-chrome \
  --user-data-dir="${CHROME_DATA_DIR}" \
  --profile-directory="${CHROME_PROFILE}" \
  --remote-debugging-port=${DEBUG_PORT} \
  --load-extension="${EXTENSION_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  "${TARGET_URL}" &

CHROME_PID=$!
echo "[MCP] Chrome PID: ${CHROME_PID}"

# Wait for Chrome to start
sleep 3

# Verify extension is loaded
echo "[MCP] Verifying extension..."
EXTENSIONS_URL="http://localhost:${DEBUG_PORT}/json/list"
if curl -s "${EXTENSIONS_URL}" | grep -q "AssistMD"; then
  echo "[MCP] Extension loaded successfully"
else
  echo "[MCP] Warning: Extension may not be loaded"
fi

# Run MCP helper if available
MCP_HELPER="$(dirname "$0")/mcp-helper.mjs"
if [ -f "$MCP_HELPER" ]; then
  echo "[MCP] Running MCP helper..."
  node "$MCP_HELPER" --port=${DEBUG_PORT}
fi

echo ""
echo "========================================="
echo "  MCP Ready"
echo "========================================="
echo "  Chrome PID:    ${CHROME_PID}"
echo "  Debug Port:    ${DEBUG_PORT}"
echo "  DevTools:      http://localhost:${DEBUG_PORT}"
echo "  Target:        ${TARGET_URL}"
echo "========================================="
echo ""
echo "Press Ctrl+C to stop Chrome"

# Wait for Chrome to exit
wait ${CHROME_PID}
