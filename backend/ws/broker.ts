/**
 * WebSocket Broker
 *
 * Manages WebSocket connections between extension and backend.
 * Handles:
 * - /ws: Command/control channel (JSON messages)
 * - Audio streaming to Deepgram
 * - Transcript broadcast to extension
 *
 * Integrates:
 * - SessionManager (PATH R)
 * - ClientRegistry (PATH U)
 * - OfflineManager (PATH W)
 * - FeedStateMachine (PATH X)
 * - DoctorIdentityManager (PATH Y)
 */

import { WebSocket, WebSocketServer, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { DeepgramConsumer, TranscriptEvent } from '../audio/deepgram-consumer.js';
import { AggregatedChunk } from '../utils/diarization.js';
import {
  createTranscriptRun,
  saveTranscriptChunks,
  updateTranscriptRun,
  updatePatientInfo,
  TranscriptChunk,
  saveConsentEvent
} from '../supabase/queries.js';
import { VAD, createEmergencyBroadcast } from '../audio/vad.js';
import { VoiceConcierge, createCommandBroadcast } from '../lib/voiceConcierge.js';
import { Autopilot, createAutopilotBroadcast } from '../lib/autopilot.js';
import { ErrorHandler, createErrorBroadcast, parseDeepgramError } from '../lib/errors.js';

// Playwright orchestration
import {
  getOrchestrator,
  PlaywrightOrchestrator,
  OrchestratorEvent,
  OrchestratorCommand
} from '../playwright/index.js';

// PATH Q-Z Integration imports
import { SessionManager } from '../lib/session.js';
import { ClientRegistry, ClientType, FeedId } from './registry.js';
import { OfflineManager } from '../supabase/offline.js';
import { FeedStateMachine } from '../lib/feedStateMachine.js';
import { DoctorIdentityManager } from '../lib/doctorIdentity.js';
import { MultiWindowManager } from '../lib/multiWindow.js';
import { getSupabaseClient } from '../supabase/client.js';

export interface Session {
  ws: WebSocket;
  clientId: string;
  userId: string;
  windowId: string | null;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
}

export interface BrokerConfig {
  saveInterval: number; // ms between chunk saves
  enableOfflineMode: boolean;
  enableMultiWindow: boolean;
}

export class WebSocketBroker {
  private wss: WebSocketServer;
  private sessions: Map<WebSocket, Session> = new Map();
  private config: BrokerConfig;
  private saveTimers: Map<number, NodeJS.Timeout> = new Map();

  // PATH J/K/L modules
  private vad: VAD;
  private voiceConcierge: VoiceConcierge;
  private autopilot: Autopilot;
  private errorHandler: ErrorHandler;

  // PATH Q-Z integrated modules
  private sessionManager: SessionManager;
  private clientRegistry: ClientRegistry;
  private offlineManager: OfflineManager | null = null;
  private feedStateMachine: FeedStateMachine;
  private doctorIdentity: DoctorIdentityManager;
  private multiWindowManager: MultiWindowManager;

  // Playwright orchestration for EHR automation
  private orchestrator: PlaywrightOrchestrator;

  constructor(wss: WebSocketServer, config?: Partial<BrokerConfig>) {
    this.wss = wss;
    this.config = {
      saveInterval: 5000,
      enableOfflineMode: true,
      enableMultiWindow: true,
      ...config
    };

    // Initialize PATH Q-Z modules
    this.sessionManager = new SessionManager({
      sessionTTL: 30 * 60 * 1000,  // 30 minutes
      cleanupInterval: 5 * 60 * 1000  // 5 minutes
    });

    this.clientRegistry = new ClientRegistry();

    // Initialize OfflineManager if Supabase is available
    const supabase = getSupabaseClient();
    if (supabase && this.config.enableOfflineMode) {
      this.offlineManager = new OfflineManager(supabase);
      this.offlineManager.on('offline', () => {
        console.warn('[Broker] Supabase offline, using queue');
        this.feedStateMachine.setFeedStatus('E', 'degraded', 'Database offline');
      });
      this.offlineManager.on('online', () => {
        console.log('[Broker] Supabase back online');
        this.feedStateMachine.setFeedStatus('E', 'ready');
      });
    }

    this.feedStateMachine = new FeedStateMachine();
    this.feedStateMachine.on('feed:status', (feedId: FeedId, status: string) => {
      this.broadcastFeedStatus(feedId, status);
    });

    this.doctorIdentity = new DoctorIdentityManager(supabase, { demoMode: !supabase });

    this.multiWindowManager = new MultiWindowManager();
    if (this.config.enableMultiWindow) {
      this.multiWindowManager.on('leader:elected', (window) => {
        console.log(`[Broker] Leader elected: ${window.id}`);
      });
      this.multiWindowManager.on('recording:conflict', (conflict) => {
        console.warn('[Broker] Recording conflict:', conflict);
      });
    }

    // Initialize VAD for emergency detection (PATH K - Feed C)
    this.vad = new VAD({
      onEmergency: (alert) => {
        console.log('[Broker] Emergency detected:', alert.phrase);
        // Map severity levels to feed state machine format
        const feedSeverity = (alert.severity === 'critical' || alert.severity === 'high')
          ? 'critical' as const
          : 'warning' as const;
        this.feedStateMachine.triggerEmergency(feedSeverity, alert.phrase);
        this.broadcastToFeed('C', createEmergencyBroadcast(alert));
      }
    });

    // Initialize Voice Concierge (PATH L - Feed B)
    this.voiceConcierge = new VoiceConcierge({
      onCommand: (cmd) => {
        console.log('[Broker] Voice command:', cmd.command);
        this.feedStateMachine.triggerVoiceCommand(cmd.command);
        this.broadcastToFeed('B', createCommandBroadcast(cmd));

        // Handle special "Assist" commands
        if (cmd.command === 'assist_consent') {
          this.handleConsentLogged(cmd);
        } else if (cmd.command === 'assist_help') {
          this.handleAssistTrigger(cmd);
        }
      }
    });

    // Initialize Autopilot (PATH J - Feed D)
    this.autopilot = new Autopilot((state) => {
      const surfaceCount = state.surfaces.length;
      if (state.status === 'READY') {
        this.feedStateMachine.setAutopilotReady(surfaceCount);
      } else if (state.status === 'LEARNING') {
        this.feedStateMachine.setAutopilotLearning(surfaceCount);
      }
      this.broadcastToFeed('D', createAutopilotBroadcast(state));
    });

    // Initialize Error Handler (PATH O - Feed A)
    this.errorHandler = new ErrorHandler((error) => {
      this.broadcastToFeed('A', createErrorBroadcast(error));
    });

    // Initialize all feeds
    this.feedStateMachine.initializeAll();

    // Initialize Playwright orchestrator for EHR automation
    this.orchestrator = getOrchestrator();
    this.orchestrator.on('event', (event: OrchestratorEvent) => {
      this.handleOrchestratorEvent(event);
    });
    this.orchestrator.on('state-change', (state) => {
      this.broadcast({
        kind: 'orchestrator_state',
        state,
        timestamp: Date.now()
      });
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('[Broker] WebSocket broker initialized with PATH Q-Z modules + Playwright orchestration');
  }

  /**
   * Handle Playwright orchestrator events
   */
  private handleOrchestratorEvent(event: OrchestratorEvent): void {
    switch (event.kind) {
      case 'connected':
        console.log('[Broker] Playwright connected to browser');
        this.broadcast({
          kind: 'ehr_connected',
          connection: event.connection,
          timestamp: Date.now()
        });
        break;

      case 'disconnected':
        console.log('[Broker] Playwright disconnected:', event.reason);
        this.broadcast({
          kind: 'ehr_disconnected',
          reason: event.reason,
          timestamp: Date.now()
        });
        break;

      case 'page-changed':
        console.log('[Broker] EHR page changed:', event.page.url);
        this.broadcast({
          kind: 'ehr_page_changed',
          page: event.page,
          timestamp: Date.now()
        });
        break;

      case 'fields-detected':
        console.log(`[Broker] Detected ${event.fields.length} EHR fields`);
        this.broadcast({
          kind: 'ehr_fields_detected',
          fields: event.fields,
          timestamp: Date.now()
        });
        break;

      case 'field-filled':
        console.log('[Broker] Field filled:', event.result.fieldId, event.result.success);
        this.broadcast({
          kind: 'ehr_field_filled',
          result: event.result,
          timestamp: Date.now()
        });
        break;

      case 'patient-extracted':
        console.log('[Broker] Patient context extracted:', event.context.name);
        this.broadcast({
          kind: 'ehr_patient_extracted',
          patient: event.context,
          timestamp: Date.now()
        });
        break;

      case 'error':
        console.error('[Broker] Orchestrator error:', event.message);
        this.broadcast({
          kind: 'ehr_error',
          error: event.message,
          details: event.details,
          timestamp: Date.now()
        });
        break;
    }
  }

  /**
   * Broadcast to specific feed subscribers
   */
  private broadcastToFeed(feed: FeedId, message: object): void {
    this.clientRegistry.broadcast(message, { feed });
  }

  /**
   * Broadcast feed status change
   */
  private broadcastFeedStatus(feed: FeedId, status: string): void {
    this.broadcastToFeed(feed, {
      kind: 'feed_status',
      feed,
      status,
      timestamp: Date.now()
    });
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '', 'http://localhost');
    const userId = url.searchParams.get('userId') || 'anonymous';
    const windowId = url.searchParams.get('windowId') || null;
    const clientType = (url.searchParams.get('type') as ClientType) || 'overlay';

    console.log(`[Broker] New connection from user: ${userId}, window: ${windowId}`);

    // Generate client ID
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Register with ClientRegistry (PATH U)
    const registeredClient = this.clientRegistry.register({
      ws,
      type: clientType,
      doctorId: userId,
      metadata: {
        windowId: windowId || undefined,
        userAgent: req.headers['user-agent']
      }
    });

    // Register with MultiWindowManager (PATH S)
    if (windowId && this.config.enableMultiWindow) {
      this.multiWindowManager.registerWindow({
        windowId,
        tabId: parseInt(url.searchParams.get('tabId') || '0'),
        ws,
        doctorId: userId,
        url: url.searchParams.get('pageUrl') || ''
      });
    }

    // Create session
    const session: Session = {
      ws,
      clientId: registeredClient.id,
      userId,
      windowId,
      transcriptId: null,
      deepgram: null,
      pendingChunks: [],
      isRecording: false
    };

    this.sessions.set(ws, session);

    // Set feeds as ready
    this.feedStateMachine.readyAll();

    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => this.handleError(ws, error));

    this.send(ws, {
      kind: 'connected',
      clientId: registeredClient.id,
      userId,
      feeds: this.feedStateMachine.getAllFeedStates()
    });
  }

  private async handleMessage(ws: WebSocket, data: RawData): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return;

    // Binary data = audio
    if (Buffer.isBuffer(data)) {
      if (session.deepgram && session.isRecording) {
        session.deepgram.sendAudio(data);
      }
      return;
    }

    // JSON message
    try {
      const message = JSON.parse(data.toString());
      await this.handleCommand(session, message);
    } catch (error) {
      console.error('[Broker] Failed to parse message:', error);
      this.send(ws, { kind: 'error', error: 'Invalid message format' });
    }
  }

  private async handleCommand(session: Session, message: any): Promise<void> {
    const { ws } = session;

    switch (message.kind) {
      case 'start_recording':
        await this.startRecording(session, message);
        break;

      case 'stop_recording':
        await this.stopRecording(session);
        break;

      case 'set_patient':
        await this.setPatient(session, message);
        break;

      case 'command':
        await this.handleActionCommand(session, message);
        break;

      case 'dom_map_result':
        // PATH J: Feed DOM map to autopilot
        this.autopilot.ingestDOMMap(message.fields || []);
        break;

      // Playwright orchestration commands
      case 'ehr_connect':
        await this.handleEhrConnect(session, message);
        break;

      case 'ehr_disconnect':
        await this.handleEhrDisconnect(session);
        break;

      case 'ehr_scan':
        await this.handleEhrScan(session);
        break;

      case 'ehr_fill':
        await this.handleEhrFill(session, message);
        break;

      case 'ehr_undo':
        await this.handleEhrUndo(session, message);
        break;

      case 'ehr_map_field':
        await this.handleEhrMapField(session, message);
        break;

      case 'ehr_read_patient':
        await this.handleEhrReadPatient(session);
        break;

      case 'ping':
        this.send(ws, { kind: 'pong', timestamp: Date.now() });
        break;

      default:
        console.warn(`[Broker] Unknown command: ${message.kind}`);
    }
  }

  private async startRecording(session: Session, message: any): Promise<void> {
    const { ws, userId } = session;

    if (session.isRecording) {
      this.send(ws, { kind: 'error', error: 'Already recording' });
      return;
    }

    try {
      // Create transcript run
      const transcriptId = await createTranscriptRun(
        userId,
        message.patientCode,
        message.patientUuid
      );
      session.transcriptId = transcriptId;

      // Initialize Deepgram
      session.deepgram = new DeepgramConsumer({
        onTranscript: (event) => this.handleTranscript(session, event),
        onChunk: (chunk) => this.handleChunk(session, chunk),
        onError: (error) => {
          // PATH O: Use error handler for Deepgram errors
          const layerError = parseDeepgramError(error);
          this.errorHandler.handle(layerError);
        },
        onClose: () => this.send(ws, { kind: 'deepgram_closed' })
      });

      await session.deepgram.connect();
      session.isRecording = true;

      // Start periodic save timer
      this.startSaveTimer(session);

      this.send(ws, {
        kind: 'recording_started',
        transcriptId
      });

      console.log(`[Broker] Recording started: transcript ${transcriptId}`);
    } catch (error: any) {
      console.error('[Broker] Failed to start recording:', error);
      this.send(ws, { kind: 'error', error: error.message });
    }
  }

  private async stopRecording(session: Session): Promise<void> {
    const { ws, transcriptId, deepgram } = session;

    if (!session.isRecording) {
      this.send(ws, { kind: 'error', error: 'Not recording' });
      return;
    }

    try {
      // Stop Deepgram
      if (deepgram) {
        deepgram.disconnect();
        session.deepgram = null;
      }

      session.isRecording = false;

      // Stop save timer
      if (transcriptId) {
        this.stopSaveTimer(transcriptId);
      }

      // Final save of pending chunks
      await this.savePendingChunks(session);

      // Mark transcript complete
      if (transcriptId) {
        await updateTranscriptRun(transcriptId);
      }

      this.send(ws, {
        kind: 'recording_stopped',
        transcriptId
      });

      console.log(`[Broker] Recording stopped: transcript ${transcriptId}`);
    } catch (error: any) {
      console.error('[Broker] Failed to stop recording:', error);
      this.send(ws, { kind: 'error', error: error.message });
    }
  }

  private async setPatient(session: Session, message: any): Promise<void> {
    const { ws, transcriptId } = session;

    if (!transcriptId) {
      this.send(ws, { kind: 'error', error: 'No active transcript' });
      return;
    }

    try {
      await updatePatientInfo(transcriptId, message.patientCode, message.patientUuid);
      this.send(ws, { kind: 'patient_set', patientCode: message.patientCode });
    } catch (error: any) {
      this.send(ws, { kind: 'error', error: error.message });
    }
  }

  /**
   * PATH I: Command Pipeline - handle map/fill/undo/send/dictate
   */
  private async handleActionCommand(session: Session, message: any): Promise<void> {
    const { ws } = session;
    const action = message.action;

    console.log(`[Broker] Command received: ${action}`);

    switch (action) {
      case 'map':
        // Request DOM mapping from extension
        this.send(ws, {
          kind: 'command_request',
          action: 'map',
          feed: 'D' // Autopilot feed
        });
        break;

      case 'fill':
        // Execute smart fill with provided steps
        this.send(ws, {
          kind: 'command_request',
          action: 'fill',
          steps: message.steps || [],
          feed: 'D'
        });
        break;

      case 'undo':
        // Request undo of last fill operation
        this.send(ws, {
          kind: 'command_request',
          action: 'undo',
          feed: 'D'
        });
        break;

      case 'send':
        // Finalize and send form
        this.send(ws, {
          kind: 'command_request',
          action: 'send',
          feed: 'D'
        });
        break;

      case 'dictate':
        // Enable direct dictation mode to focused field
        this.send(ws, {
          kind: 'command_request',
          action: 'dictate',
          targetField: message.targetField,
          feed: 'B' // Voice command feed
        });
        break;

      default:
        console.warn(`[Broker] Unknown action: ${action}`);
        this.send(ws, { kind: 'error', error: `Unknown action: ${action}` });
    }
  }

  private handleTranscript(session: Session, event: TranscriptEvent): void {
    // Send to extension for display
    this.send(session.ws, {
      kind: 'transcript',
      text: event.text,
      speaker: event.speaker,
      isFinal: event.isFinal,
      start: event.start,
      end: event.end
    });

    // PATH K: Check for emergency phrases (Feed C)
    if (event.isFinal) {
      this.vad.analyzeTranscript(event.text);
    }

    // PATH L: Check for voice commands (Feed B)
    if (event.isFinal) {
      this.voiceConcierge.analyzeTranscript(event.text);
    }
  }

  /**
   * Handle "Assist, consent granted" command
   * Logs consent event and broadcasts to UI
   */
  private async handleConsentLogged(cmd: any): Promise<void> {
    // Get current active session to find transcript ID
    let transcriptId: number | null = null;
    for (const session of this.sessions.values()) {
      if (session.isRecording && session.transcriptId) {
        transcriptId = session.transcriptId;
        break;
      }
    }

    const consentEvent = {
      kind: 'consent_logged',
      feed: 'E',
      consent: {
        timestamp: cmd.timestamp,
        phrase: cmd.rawPhrase,
        transcriptId
      }
    };

    console.log('[Broker] Consent logged:', consentEvent);

    // Update feed state machine (PATH X)
    this.feedStateMachine.logConsent(cmd.rawPhrase);

    // Broadcast to all clients via registry (PATH U)
    this.clientRegistry.broadcastConsent({
      timestamp: cmd.timestamp,
      phrase: cmd.rawPhrase
    });

    // Persist to Supabase (PATH W with offline fallback)
    if (transcriptId) {
      try {
        if (this.offlineManager) {
          await this.offlineManager.insert('consent_events', {
            transcript_id: transcriptId,
            phrase: cmd.rawPhrase,
            timestamp: new Date(cmd.timestamp).toISOString()
          });
        } else {
          await saveConsentEvent(transcriptId, cmd.rawPhrase, cmd.timestamp);
        }
      } catch (error) {
        console.error('[Broker] Failed to persist consent event:', error);
      }
    }
  }

  /**
   * Handle "Assist, help me" command
   * Triggers conversational agent (future: TTS response)
   */
  private handleAssistTrigger(cmd: any): void {
    const assistEvent = {
      kind: 'assist_triggered',
      feed: 'F', // Future: Audio response feed
      assist: {
        timestamp: cmd.timestamp,
        phrase: cmd.rawPhrase,
        // TODO: Extract context for LLM
        // context: { transcript: '...', dom: '...' }
      }
    };

    console.log('[Broker] Assist triggered:', assistEvent);

    // Broadcast to notify UI
    this.broadcast(assistEvent);

    // TODO: Route to conversational agent
    // await this.conversationAgent.handleQuery(cmd.rawPhrase, context);
  }

  private handleChunk(session: Session, chunk: AggregatedChunk): void {
    // Queue chunk for batch save
    session.pendingChunks.push(chunk as TranscriptChunk);

    // Send chunk event to extension
    this.send(session.ws, {
      kind: 'chunk',
      speaker: chunk.speaker,
      text: chunk.text,
      wordCount: chunk.word_count,
      duration: chunk.end - chunk.start
    });
  }

  private startSaveTimer(session: Session): void {
    if (!session.transcriptId) return;

    const timer = setInterval(async () => {
      await this.savePendingChunks(session);
    }, this.config.saveInterval);

    this.saveTimers.set(session.transcriptId, timer);
  }

  private stopSaveTimer(transcriptId: number): void {
    const timer = this.saveTimers.get(transcriptId);
    if (timer) {
      clearInterval(timer);
      this.saveTimers.delete(transcriptId);
    }
  }

  private async savePendingChunks(session: Session): Promise<void> {
    if (!session.transcriptId || session.pendingChunks.length === 0) return;

    const chunks = [...session.pendingChunks];
    session.pendingChunks = [];

    try {
      await saveTranscriptChunks(session.transcriptId, chunks);
    } catch (error) {
      // Re-queue chunks on failure
      session.pendingChunks.unshift(...chunks);
      console.error('[Broker] Failed to save chunks, will retry:', error);
    }
  }

  private handleClose(ws: WebSocket): void {
    const session = this.sessions.get(ws);
    if (session) {
      console.log(`[Broker] Connection closed: ${session.userId}`);

      // Unregister from ClientRegistry (PATH U)
      this.clientRegistry.unregister(session.clientId);

      // Unregister from MultiWindowManager (PATH S)
      if (session.windowId && this.config.enableMultiWindow) {
        this.multiWindowManager.unregisterWindow(session.windowId);
      }

      if (session.deepgram) {
        session.deepgram.disconnect();
      }
      if (session.transcriptId) {
        this.stopSaveTimer(session.transcriptId);
        this.savePendingChunks(session);
      }
      this.sessions.delete(ws);
    }
  }

  private handleError(ws: WebSocket, error: Error): void {
    console.error('[Broker] WebSocket error:', error);
    const session = this.sessions.get(ws);
    if (session) {
      this.send(ws, { kind: 'error', error: error.message });
    }
  }

  private send(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const [ws] of this.sessions) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Get active session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  // ============================================
  // EHR Orchestration Handlers
  // ============================================

  /**
   * Connect to EHR browser via CDP WebSocket endpoint
   */
  private async handleEhrConnect(session: Session, message: any): Promise<void> {
    const { ws } = session;
    const wsEndpoint = message.wsEndpoint;

    if (!wsEndpoint) {
      this.send(ws, { kind: 'error', error: 'wsEndpoint is required' });
      return;
    }

    try {
      console.log(`[Broker] Connecting to EHR browser: ${wsEndpoint}`);
      await this.orchestrator.connect(wsEndpoint);
      this.send(ws, {
        kind: 'ehr_connect_success',
        state: this.orchestrator.getState(),
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('[Broker] EHR connect failed:', error);
      this.send(ws, { kind: 'error', error: `EHR connect failed: ${error.message}` });
    }
  }

  /**
   * Disconnect from EHR browser
   */
  private async handleEhrDisconnect(session: Session): Promise<void> {
    const { ws } = session;

    try {
      await this.orchestrator.disconnect();
      this.send(ws, {
        kind: 'ehr_disconnect_success',
        timestamp: Date.now()
      });
    } catch (error: any) {
      this.send(ws, { kind: 'error', error: `EHR disconnect failed: ${error.message}` });
    }
  }

  /**
   * Scan EHR page for fields and patient context
   */
  private async handleEhrScan(session: Session): Promise<void> {
    const { ws } = session;

    if (!this.orchestrator.isConnected()) {
      this.send(ws, { kind: 'error', error: 'Not connected to EHR browser' });
      return;
    }

    try {
      console.log('[Broker] Scanning EHR page...');
      const snapshot = await this.orchestrator.scanPage();
      this.send(ws, {
        kind: 'ehr_scan_complete',
        snapshot,
        timestamp: Date.now()
      });
    } catch (error: any) {
      this.send(ws, { kind: 'error', error: `EHR scan failed: ${error.message}` });
    }
  }

  /**
   * Fill EHR field(s) with transcript data
   */
  private async handleEhrFill(session: Session, message: any): Promise<void> {
    const { ws } = session;

    if (!this.orchestrator.isConnected()) {
      this.send(ws, { kind: 'error', error: 'Not connected to EHR browser' });
      return;
    }

    try {
      // Single field fill
      if (message.request) {
        const result = await this.orchestrator.fillField(message.request);
        this.send(ws, {
          kind: 'ehr_fill_result',
          result,
          timestamp: Date.now()
        });
      }
      // Batch fill
      else if (message.requests) {
        const batch = await this.orchestrator.fillBatch(message.requests);
        this.send(ws, {
          kind: 'ehr_batch_result',
          batch,
          timestamp: Date.now()
        });
      }
      // Fill from transcript sources
      else if (message.transcriptData) {
        const batch = await this.orchestrator.fillFromTranscript(message.transcriptData);
        this.send(ws, {
          kind: 'ehr_batch_result',
          batch,
          timestamp: Date.now()
        });
      }
      else {
        this.send(ws, { kind: 'error', error: 'Missing request, requests, or transcriptData' });
      }
    } catch (error: any) {
      this.send(ws, { kind: 'error', error: `EHR fill failed: ${error.message}` });
    }
  }

  /**
   * Undo last EHR fill operation
   */
  private async handleEhrUndo(session: Session, message: any): Promise<void> {
    const { ws } = session;

    if (!this.orchestrator.isConnected()) {
      this.send(ws, { kind: 'error', error: 'Not connected to EHR browser' });
      return;
    }

    try {
      const result = await this.orchestrator.undoFill(message.fieldId);
      this.send(ws, {
        kind: 'ehr_undo_result',
        result,
        timestamp: Date.now()
      });
    } catch (error: any) {
      this.send(ws, { kind: 'error', error: `EHR undo failed: ${error.message}` });
    }
  }

  /**
   * Map an EHR field to a transcript source
   */
  private async handleEhrMapField(session: Session, message: any): Promise<void> {
    const { ws } = session;

    const { fieldId, source } = message;
    if (!fieldId || !source) {
      this.send(ws, { kind: 'error', error: 'fieldId and source are required' });
      return;
    }

    try {
      const mapping = await this.orchestrator.mapField(fieldId, source);
      this.send(ws, {
        kind: 'ehr_mapping_created',
        mapping,
        timestamp: Date.now()
      });
    } catch (error: any) {
      this.send(ws, { kind: 'error', error: `EHR map failed: ${error.message}` });
    }
  }

  /**
   * Read patient context from EHR page
   */
  private async handleEhrReadPatient(session: Session): Promise<void> {
    const { ws } = session;

    if (!this.orchestrator.isConnected()) {
      this.send(ws, { kind: 'error', error: 'Not connected to EHR browser' });
      return;
    }

    try {
      const context = await this.orchestrator.readPatientContext();
      this.send(ws, {
        kind: 'ehr_patient_context',
        context,
        timestamp: Date.now()
      });
    } catch (error: any) {
      this.send(ws, { kind: 'error', error: `EHR read patient failed: ${error.message}` });
    }
  }
}
