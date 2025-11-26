# MCP Stack (Model Context Protocol)

## Overview

MCP (Model Context Protocol) is used for Chrome extension development with Claude. It provides tools for interacting with the browser during development.

## MCP Configuration

### Location

```
~/.config/claude-code/settings.json
```

### Chrome Extension Development Setup

```json
{
  "mcpServers": {
    "chrome-extension": {
      "command": "npx",
      "args": [
        "@anthropic-ai/mcp-server-puppeteer"
      ],
      "env": {
        "CHROME_PATH": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "HEADLESS": "false"
      }
    }
  }
}
```

## Starting Chrome with Extension

### Script: `scripts/start-mcp.sh`

```bash
#!/bin/bash
# Start Chrome with GHOST-NEXT extension loaded

EXTENSION_PATH="$(pwd)/extension"
PROFILE_PATH="$(pwd)/.chrome-profile"

# Create profile directory if needed
mkdir -p "$PROFILE_PATH"

# Launch Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROFILE_PATH" \
  --load-extension="$EXTENSION_PATH" \
  --no-first-run \
  --no-default-browser-check \
  --disable-default-apps \
  "$@"
```

## MCP Tools for Extension Development

### Browser Control

```typescript
// Navigate to URL
await mcp.browser.navigate('https://example.com');

// Screenshot
await mcp.browser.screenshot();

// Execute script
await mcp.browser.evaluate('document.title');
```

### Extension Interaction

```typescript
// Check if content script loaded
await mcp.browser.evaluate(`
  document.getElementById('ghost-overlay-root') !== null
`);

// Trigger recording
await mcp.browser.evaluate(`
  document.getElementById('ghost-overlay-root')
    .shadowRoot.getElementById('recordBtn').click()
`);
```

## Development Workflow

### 1. Start Backend

```bash
cd backend
npm run dev
```

### 2. Start Chrome with Extension

```bash
./scripts/start-mcp.sh
```

### 3. Test Extension

```bash
# Navigate to test page
# Click extension icon or use overlay
# Verify transcription works
```

## Debugging with MCP

### Console Logs

```typescript
// Content script logs
await mcp.browser.evaluate(`
  console.log('[DEBUG]', window.__ghostState)
`);
```

### Network Inspection

```typescript
// Check WebSocket connection
await mcp.browser.evaluate(`
  performance.getEntriesByType('resource')
    .filter(r => r.name.includes('ws://'))
`);
```

## Extension Reload

During development, reload extension after changes:

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Reload" on GHOST-NEXT extension

Or via script:

```bash
./scripts/reset-profile.sh
./scripts/start-mcp.sh
```

## Common Issues

### Extension Not Loading

1. Check `manifest.json` syntax
2. Verify all referenced files exist
3. Check Chrome DevTools for errors

### WebSocket Connection Failed

1. Ensure backend is running
2. Check CORS configuration
3. Verify port 3001 is available

### No Transcript Output

1. Check Deepgram API key
2. Verify microphone permissions
3. Check backend logs for errors

## Production Considerations

MCP is for development only. Production extensions should:

1. Use proper Chrome Web Store distribution
2. Handle permissions gracefully
3. Work without MCP tools
