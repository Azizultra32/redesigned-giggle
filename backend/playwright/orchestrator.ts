/**
 * Playwright Orchestrator
 *
 * Main orchestration layer that coordinates browser management,
 * field detection, auto-filling, and DOM reading.
 * Exposes a unified API for WebSocket integration.
 */

import { EventEmitter } from 'events';
import { BrowserManager, getBrowserManager } from './browser.js';
import { FieldDetector } from './detector.js';
import { AutoFiller } from './filler.js';
import { DomReader } from './reader.js';
import {
  OrchestratorState,
  OrchestratorCommand,
  OrchestratorEvent,
  DetectedField,
  FieldMapping,
  FillRequest,
  FillResult,
  FillBatch,
  DomSnapshot,
  ExtractedPatientContext,
  TranscriptSource,
  EhrType
} from './types.js';

export class PlaywrightOrchestrator extends EventEmitter {
  private browserManager: BrowserManager;
  private detector: FieldDetector | null = null;
  private filler: AutoFiller | null = null;
  private reader: DomReader | null = null;
  private mappings: Map<string, FieldMapping> = new Map();
  private state: OrchestratorState;

  constructor() {
    super();
    this.browserManager = getBrowserManager();
    this.state = this.getInitialState();

    // Forward browser events
    this.browserManager.on('event', (event: OrchestratorEvent) => {
      this.handleBrowserEvent(event);
    });
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Execute an orchestrator command
   */
  async execute(command: OrchestratorCommand): Promise<unknown> {
    try {
      switch (command.kind) {
        case 'connect':
          return await this.connect(command.wsEndpoint);

        case 'disconnect':
          return await this.disconnect();

        case 'scan-page':
          return await this.scanPage();

        case 'detect-fields':
          return await this.detectFields();

        case 'map-field':
          return await this.mapField(command.fieldId, command.source);

        case 'fill-field':
          return await this.fillField(command.request);

        case 'fill-batch':
          return await this.fillBatch(command.requests);

        case 'read-patient':
          return await this.readPatientContext();

        case 'undo-fill':
          return await this.undoFill(command.fieldId);

        case 'highlight-field':
          return await this.highlightField(command.fieldId);

        case 'clear-highlights':
          return await this.clearHighlights();

        default:
          throw new Error(`Unknown command: ${(command as OrchestratorCommand).kind}`);
      }
    } catch (error) {
      this.emitError(error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Connect to a browser
   */
  async connect(wsEndpoint: string): Promise<void> {
    const connection = await this.browserManager.connect(wsEndpoint);
    this.state.connection = connection;

    // Initialize page tools
    await this.initializeTools();
  }

  /**
   * Launch a new browser (for development)
   */
  async launch(): Promise<void> {
    const connection = await this.browserManager.launch({ headless: false });
    this.state.connection = connection;
    await this.initializeTools();
  }

  /**
   * Disconnect from browser
   */
  async disconnect(): Promise<void> {
    await this.browserManager.disconnect();
    this.detector = null;
    this.filler = null;
    this.reader = null;
    this.state = this.getInitialState();
  }

  /**
   * Scan current page for EHR type and fields
   */
  async scanPage(): Promise<DomSnapshot | null> {
    if (!this.reader) {
      throw new Error('Not connected to browser');
    }

    this.state.isScanning = true;
    this.emitStateChange();

    try {
      const snapshot = await this.reader.createSnapshot();
      this.state.lastSnapshot = snapshot;
      this.state.detectedFields = snapshot.fields;
      this.state.isScanning = false;

      // Update active page info
      this.state.activePage = await this.browserManager.getActivePageInfo();

      this.emitStateChange();

      this.emit('event', {
        kind: 'fields-detected',
        fields: snapshot.fields
      } as OrchestratorEvent);

      if (snapshot.patientContext) {
        this.emit('event', {
          kind: 'patient-extracted',
          context: snapshot.patientContext
        } as OrchestratorEvent);
      }

      return snapshot;
    } catch (error) {
      this.state.isScanning = false;
      this.emitStateChange();
      throw error;
    }
  }

  /**
   * Detect fields on current page
   */
  async detectFields(): Promise<DetectedField[]> {
    if (!this.detector) {
      throw new Error('Not connected to browser');
    }

    const fields = await this.detector.detectFields();
    this.state.detectedFields = fields;

    this.emit('event', {
      kind: 'fields-detected',
      fields
    } as OrchestratorEvent);

    return fields;
  }

  /**
   * Map a field to a transcript source
   */
  async mapField(fieldId: string, source: TranscriptSource): Promise<FieldMapping | null> {
    const field = this.state.detectedFields.find(f => f.id === fieldId);
    if (!field || !this.filler) {
      return null;
    }

    const mapping = this.filler.createMapping(fieldId, field.selector, source, true);
    this.mappings.set(fieldId, mapping);
    this.state.mappings = Array.from(this.mappings.values());

    return mapping;
  }

  /**
   * Fill a single field
   */
  async fillField(request: FillRequest): Promise<FillResult> {
    if (!this.filler) {
      throw new Error('Not connected to browser');
    }

    const result = await this.filler.fillField(request);

    this.emit('event', {
      kind: 'field-filled',
      result
    } as OrchestratorEvent);

    return result;
  }

  /**
   * Fill multiple fields
   */
  async fillBatch(requests: FillRequest[]): Promise<FillBatch> {
    if (!this.filler) {
      throw new Error('Not connected to browser');
    }

    const batch = await this.filler.fillBatch(requests);
    this.state.pendingFills.push(batch);

    return batch;
  }

  /**
   * Read patient context from page
   */
  async readPatientContext(): Promise<ExtractedPatientContext | null> {
    if (!this.reader) {
      throw new Error('Not connected to browser');
    }

    const context = await this.reader.extractPatientContext();

    this.emit('event', {
      kind: 'patient-extracted',
      context
    } as OrchestratorEvent);

    return context;
  }

  /**
   * Undo a field fill
   */
  async undoFill(fieldId: string): Promise<FillResult | null> {
    if (!this.filler) {
      throw new Error('Not connected to browser');
    }

    return await this.filler.undoField(fieldId);
  }

  /**
   * Highlight a field
   */
  async highlightField(fieldId: string): Promise<void> {
    if (!this.detector) {
      throw new Error('Not connected to browser');
    }

    await this.detector.highlightField(fieldId);
  }

  /**
   * Clear all highlights
   */
  async clearHighlights(): Promise<void> {
    if (!this.detector) {
      throw new Error('Not connected to browser');
    }

    await this.detector.clearHighlights();
  }

  /**
   * Get current state
   */
  getState(): OrchestratorState {
    return { ...this.state };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.browserManager.isConnected();
  }

  /**
   * Fill fields from transcript data
   */
  async fillFromTranscript(
    transcriptData: Record<TranscriptSource, string>
  ): Promise<FillBatch> {
    const requests: FillRequest[] = [];

    for (const mapping of this.mappings.values()) {
      if (!mapping.autoFill) continue;

      const value = transcriptData[mapping.transcriptSource];
      if (!value) continue;

      const field = this.state.detectedFields.find(f => f.selector === mapping.fieldSelector);
      if (!field) continue;

      requests.push({
        fieldId: field.id,
        selector: field.selector,
        value,
        append: false
      });
    }

    return await this.fillBatch(requests);
  }

  // ============================================
  // Private Methods
  // ============================================

  private async initializeTools(): Promise<void> {
    const page = this.browserManager.getActivePage();
    if (!page) return;

    // Get page info to determine EHR type
    const pageInfo = await this.browserManager.getActivePageInfo();
    const ehrType: EhrType = pageInfo?.ehrType ?? 'unknown';

    this.detector = new FieldDetector(page, ehrType);
    this.filler = new AutoFiller(page, this.detector);
    this.reader = new DomReader(page, this.detector, ehrType);

    this.state.activePage = pageInfo;
  }

  private handleBrowserEvent(event: OrchestratorEvent): void {
    switch (event.kind) {
      case 'connected':
        this.state.connection = event.connection;
        break;

      case 'disconnected':
        this.state.connection = null;
        this.state.activePage = null;
        break;

      case 'page-changed':
        this.state.activePage = event.page;
        // Reinitialize tools for new page
        this.initializeTools();
        break;

      case 'error':
        this.state.error = event.message;
        break;
    }

    this.emit('event', event);
  }

  private getInitialState(): OrchestratorState {
    return {
      connection: null,
      activePage: null,
      detectedFields: [],
      mappings: [],
      pendingFills: [],
      lastSnapshot: null,
      isScanning: false,
      error: null
    };
  }

  private emitStateChange(): void {
    this.emit('state-change', this.getState());
  }

  private emitError(message: string): void {
    this.state.error = message;
    this.emit('event', {
      kind: 'error',
      message
    } as OrchestratorEvent);
  }
}

// Singleton instance
let orchestrator: PlaywrightOrchestrator | null = null;

export function getOrchestrator(): PlaywrightOrchestrator {
  if (!orchestrator) {
    orchestrator = new PlaywrightOrchestrator();
  }
  return orchestrator;
}
