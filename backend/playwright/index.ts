/**
 * Playwright Orchestration Module
 *
 * Browser automation for EHR integration.
 *
 * Features:
 * - Connect to existing browser instances via CDP
 * - Detect and categorize form fields
 * - Auto-fill fields from transcript data
 * - Extract patient context from EHR pages
 * - Undo/redo fill operations
 *
 * Usage:
 *   import { getOrchestrator } from './playwright';
 *
 *   const orchestrator = getOrchestrator();
 *   await orchestrator.connect('ws://localhost:9222/devtools/browser/...');
 *   await orchestrator.scanPage();
 *   const fields = orchestrator.getState().detectedFields;
 */

// Main orchestrator
export { PlaywrightOrchestrator, getOrchestrator } from './orchestrator.js';

// Browser connection
export { BrowserManager, getBrowserManager } from './browser.js';

// Field detection
export { FieldDetector } from './detector.js';

// Auto-fill service
export { AutoFiller } from './filler.js';

// DOM reading
export { DomReader } from './reader.js';

// Types
export * from './types.js';
