#!/bin/bash
# Reset Chrome profile for GHOST-NEXT development
# Clears all browser state for a fresh start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_PATH="$PROJECT_DIR/.chrome-profile"

echo "GHOST-NEXT Chrome Profile Reset"
echo "================================"
echo ""

if [ -d "$PROFILE_PATH" ]; then
  echo "Profile directory: $PROFILE_PATH"
  echo ""

  # Check if Chrome is running with this profile
  if pgrep -f "$PROFILE_PATH" > /dev/null 2>&1; then
    echo "Warning: Chrome appears to be using this profile"
    read -p "Kill Chrome processes? (y/n) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
      pkill -f "$PROFILE_PATH" || true
      sleep 2
    else
      echo "Aborted. Please close Chrome first."
      exit 1
    fi
  fi

  echo "Removing profile directory..."
  rm -rf "$PROFILE_PATH"
  echo "Done."
else
  echo "Profile directory does not exist: $PROFILE_PATH"
  echo "Nothing to reset."
fi

echo ""
echo "Profile reset complete."
echo "Run './scripts/start-mcp.sh' to create a fresh profile."
