/**
 * Background Service Worker
 *
 * Handles extension lifecycle, browser action events,
 * and coordination between content scripts and the agent.
 */

// Track connected content scripts
const connectedPorts: Map<number, chrome.runtime.Port> = new Map();

// Listen for connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ghost-next-overlay') return;

  const tabId = port.sender?.tab?.id;
  if (!tabId) return;

  console.log(`[Background] Content script connected from tab ${tabId}`);
  connectedPorts.set(tabId, port);

  port.onMessage.addListener((message) => {
    handleContentMessage(tabId, message);
  });

  port.onDisconnect.addListener(() => {
    console.log(`[Background] Content script disconnected from tab ${tabId}`);
    connectedPorts.delete(tabId);
  });
});

// Handle messages from content scripts
function handleContentMessage(tabId: number, message: { type: string; data?: unknown; messageId?: string }) {
  console.log(`[Background] Message from tab ${tabId}:`, message.type);

  switch (message.type) {
    case 'recording-started':
      updateBadge(tabId, 'REC', '#e63946');
      break;

    case 'recording-stopped':
      updateBadge(tabId, '', '');
      break;

    case 'connection':
      const connected = (message.data as { connected: boolean })?.connected;
      if (!connected) {
        updateBadge(tabId, '!', '#ff9800');
      }
      break;

    default:
      // Forward other messages as needed
      break;
  }
}

// Update extension badge for a tab
function updateBadge(tabId: number, text: string, color: string) {
  chrome.action.setBadgeText({ text, tabId });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  }
}

// Handle browser action click (toolbar icon)
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;

  const port = connectedPorts.get(tab.id);
  if (port) {
    // Toggle overlay visibility
    port.postMessage({ type: 'toggle-overlay' });
  } else {
    // Inject content script if not already injected
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['dist/content.js']
    }).catch(err => {
      console.error('[Background] Failed to inject content script:', err);
    });
  }
});

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    // First-time setup
    chrome.storage.local.set({
      settings: {
        autoConnect: true,
        agentUrl: 'ws://localhost:3001/ws',
        theme: 'dark'
      }
    });
  }
});

// Handle messages from external sources (if needed)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[Background] External message:', message);
  sendResponse({ success: true });
});

// Keep service worker alive during recording
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    // Ping to keep service worker alive
    console.log('[Background] Keep-alive ping');
  }, 25000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Export for testing
export { connectedPorts, handleContentMessage, startKeepAlive, stopKeepAlive };
