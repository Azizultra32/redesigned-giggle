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

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('[Broker] WebSocket broker initialized with PATH Q-Z modules');
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
      type: 'feed_status',
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
      type: 'connected',
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
      this.send(ws, { type: 'error', error: 'Invalid message format' });
    }
  }

  private async handleCommand(session: Session, message: any): Promise<void> {
    const { ws } = session;

    switch (message.type) {
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

      case 'ping':
        this.send(ws, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        console.warn(`[Broker] Unknown command: ${message.type}`);
    }
  }

  private async startRecording(session: Session, message: any): Promise<void> {
    const { ws, userId } = session;

    if (session.isRecording) {
      this.send(ws, { type: 'error', error: 'Already recording' });
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
        onClose: () => this.send(ws, { type: 'deepgram_closed' })
      });

      await session.deepgram.connect();
      session.isRecording = true;

      // Start periodic save timer
      this.startSaveTimer(session);

      this.send(ws, {
        type: 'recording_started',
        transcriptId
      });

      console.log(`[Broker] Recording started: transcript ${transcriptId}`);
    } catch (error: any) {
      console.error('[Broker] Failed to start recording:', error);
      this.send(ws, { type: 'error', error: error.message });
    }
  }

  private async stopRecording(session: Session): Promise<void> {
    const { ws, transcriptId, deepgram } = session;

    if (!session.isRecording) {
      this.send(ws, { type: 'error', error: 'Not recording' });
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
        type: 'recording_stopped',
        transcriptId
      });

      console.log(`[Broker] Recording stopped: transcript ${transcriptId}`);
    } catch (error: any) {
      console.error('[Broker] Failed to stop recording:', error);
      this.send(ws, { type: 'error', error: error.message });
    }
  }

  private async setPatient(session: Session, message: any): Promise<void> {
    const { ws, transcriptId } = session;

    if (!transcriptId) {
      this.send(ws, { type: 'error', error: 'No active transcript' });
      return;
    }

    try {
      await updatePatientInfo(transcriptId, message.patientCode, message.patientUuid);
      this.send(ws, { type: 'patient_set', patientCode: message.patientCode });
    } catch (error: any) {
      this.send(ws, { type: 'error', error: error.message });
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
          type: 'command_request',
          action: 'map',
          feed: 'D' // Autopilot feed
        });
        break;

      case 'fill':
        // Execute smart fill with provided steps
        this.send(ws, {
          type: 'command_request',
          action: 'fill',
          steps: message.steps || [],
          feed: 'D'
        });
        break;

      case 'undo':
        // Request undo of last fill operation
        this.send(ws, {
          type: 'command_request',
          action: 'undo',
          feed: 'D'
        });
        break;

      case 'send':
        // Finalize and send form
        this.send(ws, {
          type: 'command_request',
          action: 'send',
          feed: 'D'
        });
        break;

      case 'dictate':
        // Enable direct dictation mode to focused field
        this.send(ws, {
          type: 'command_request',
          action: 'dictate',
          targetField: message.targetField,
          feed: 'B' // Voice command feed
        });
        break;

      default:
        console.warn(`[Broker] Unknown action: ${action}`);
        this.send(ws, { type: 'error', error: `Unknown action: ${action}` });
    }
  }

  private handleTranscript(session: Session, event: TranscriptEvent): void {
    // Send to extension for display
    this.send(session.ws, {
      type: 'transcript',
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
      type: 'consent_logged',
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
      type: 'assist_triggered',
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
      type: 'chunk',
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
      this.send(ws, { type: 'error', error: error.message });
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
}
