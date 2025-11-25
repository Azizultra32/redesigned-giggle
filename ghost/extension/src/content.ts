/**
 * Content Script - Entry Point
 *
 * This script runs in the context of web pages and is responsible for:
 * 1. Injecting the Ferrari overlay into the page
 * 2. Initializing the runtime and bridge
 * 3. Handling communication with the background service worker
 */

import { FerrariOverlay } from './overlay';
import { Bridge } from './bridge';
import { AudioCapture } from './audio-capture';
import { DOMMapper } from './domMapper';

// Prevent multiple injections
if ((window as any).__GHOST_NEXT_INJECTED__) {
  console.log('[GHOST-NEXT] Already injected, skipping...');
} else {
  (window as any).__GHOST_NEXT_INJECTED__ = true;
  initializeOverlay();
}

async function initializeOverlay(): Promise<void> {
  console.log('[GHOST-NEXT] Initializing Ferrari Overlay...');

  try {
    // Initialize bridge for messaging
    const bridge = new Bridge();

    // Initialize audio capture system
    const audioCapture = new AudioCapture(bridge);

    // Initialize DOM mapper for field detection
    const domMapper = new DOMMapper(bridge);

    // Create and mount the overlay
    const overlay = new FerrariOverlay(bridge);
    overlay.mount();

    // Setup bridge handlers
    setupBridgeHandlers(bridge, audioCapture, domMapper);

    // Connect to background service worker
    await bridge.connect();

    console.log('[GHOST-NEXT] Ferrari Overlay initialized successfully');
  } catch (error) {
    console.error('[GHOST-NEXT] Failed to initialize overlay:', error);
  }
}

function setupBridgeHandlers(
  bridge: Bridge,
  audioCapture: AudioCapture,
  domMapper: DOMMapper
): void {
  // Handle recording commands
  bridge.on('start-recording', async () => {
    try {
      await audioCapture.start();
      bridge.emit('recording-started', {});
    } catch (error) {
      console.error('[GHOST-NEXT] Failed to start recording:', error);
      bridge.emit('recording-error', { error: String(error) });
    }
  });

  bridge.on('stop-recording', async () => {
    try {
      await audioCapture.stop();
      bridge.emit('recording-stopped', {});
    } catch (error) {
      console.error('[GHOST-NEXT] Failed to stop recording:', error);
    }
  });

  // Handle DOM mapping commands
  bridge.on('map-fields', () => {
    const fields = domMapper.detectFields();
    bridge.emit('fields-detected', { fields });
  });

  bridge.on('get-patient-info', () => {
    const patientInfo = domMapper.extractPatientInfo();
    bridge.emit('patient', patientInfo);
  });

  // Handle messages from background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[GHOST-NEXT] Received message from background:', message);

    switch (message.type) {
      case 'TOGGLE_OVERLAY':
        // Toggle overlay visibility via bridge
        bridge.emit('toggle-overlay', {});
        sendResponse({ success: true });
        break;

      case 'GET_STATUS':
        sendResponse({
          success: true,
          status: {
            injected: true,
            recording: audioCapture.isRecording(),
            connected: bridge.isConnected()
          }
        });
        break;

      case 'TRANSCRIPT_UPDATE':
        bridge.emit('transcript', message.data);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep channel open for async response
  });
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  console.log('[GHOST-NEXT] Page unloading, cleaning up...');
  // Bridge and audio capture will handle their own cleanup
});
