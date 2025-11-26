/**
 * WebSocket Broker
 *
 * Manages WebSocket connections between extension and backend.
 * Handles:
 * - /ws: Command/control channel (JSON messages)
 * - Audio streaming to Deepgram
 * - Transcript broadcast to extension
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
  TranscriptChunk
} from '../supabase/queries.js';
import { VAD, createEmergencyBroadcast } from '../audio/vad.js';
import { VoiceConcierge, createCommandBroadcast } from '../lib/voiceConcierge.js';
import { Autopilot, createAutopilotBroadcast } from '../lib/autopilot.js';
import { ErrorHandler, createError, createErrorBroadcast, parseDeepgramError, ERROR_CODES } from '../lib/errors.js';

export interface Session {
  ws: WebSocket;
  userId: string;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
}

export interface BrokerConfig {
  saveInterval: number; // ms between chunk saves
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

  constructor(wss: WebSocketServer, config?: Partial<BrokerConfig>) {
    this.wss = wss;
    this.config = {
      saveInterval: 5000,
      ...config
    };

    // Initialize VAD for emergency detection (PATH K - Feed C)
    this.vad = new VAD({
      onEmergency: (alert) => {
        console.log('[Broker] Emergency detected:', alert.phrase);
        this.broadcast(createEmergencyBroadcast(alert));
      }
    });

    // Initialize Voice Concierge (PATH L - Feed B)
    this.voiceConcierge = new VoiceConcierge({
      onCommand: (cmd) => {
        console.log('[Broker] Voice command:', cmd.command);
        this.broadcast(createCommandBroadcast(cmd));
      }
    });

    // Initialize Autopilot (PATH J - Feed D)
    this.autopilot = new Autopilot((state) => {
      this.broadcast(createAutopilotBroadcast(state));
    });

    // Initialize Error Handler (PATH O - Feed A)
    this.errorHandler = new ErrorHandler((error) => {
      this.broadcast(createErrorBroadcast(error));
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('[Broker] WebSocket broker initialized');
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '', 'http://localhost');
    const userId = url.searchParams.get('userId') || 'anonymous';

    console.log(`[Broker] New connection from user: ${userId}`);

    const session: Session = {
      ws,
      userId,
      transcriptId: null,
      deepgram: null,
      pendingChunks: [],
      isRecording: false
    };

    this.sessions.set(ws, session);

    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => this.handleError(ws, error));

    this.send(ws, { type: 'connected', userId });
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
