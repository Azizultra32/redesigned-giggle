/**
 * AssistMD Truth Package - CNS Agent Server
 * 
 * Express server with WebSocket support for:
 * - /ws: WebSocket with Feed A-E model
 * - /health: Health check
 * - /dom: DOM recognition for patient binding
 * - /patient/current: Get latest transcript for user
 * - /transcripts/:id: Get specific transcript
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { WsBridge } from './lib/ws-bridge.js';
import { DeepgramConsumer } from './audio/deepgram-consumer.js';
import { TabManager, DomMap, PatientHint } from './lib/tab-manager.js';
import { CommandRouter, CommandAction } from './lib/command-router.js';
import { Autopilot } from './lib/autopilot.js';
import {
  createTranscriptRun,
  saveTranscriptChunks,
  completeTranscriptRun,
  updatePatientInfo,
  getTranscript,
  getLatestTranscript,
  generateEphemeralPatientCode
} from './lib/supabase.js';
import { TranscriptChunk, TranscriptEvent } from './types/index.js';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;
const DEMO_DOCTOR_ID = process.env.DEMO_DOCTOR_ID || '00000000-0000-0000-0000-000000000000';

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// ============================================================================
// Core Modules (initialized before routes)
// ============================================================================

// Initialize WsBridge
const wsBridge = new WsBridge();

// Initialize TabManager, CommandRouter, and Autopilot
const tabManager = new TabManager();
const commandRouter = new CommandRouter(tabManager);
const autopilot = new Autopilot(tabManager);

// Setup active tab change handler
tabManager.setOnActiveTabChange((tabId) => {
  // Broadcast to all clients
  wsBridge.broadcast({
    type: 'active_tab_changed',
    tabId,
    timestamp: Date.now()
  });
});

// ============================================================================
// HTTP Endpoints
// ============================================================================

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'cns-agent',
    feeds: {
      A: wsBridge.getFeedStatus('A'),
      B: wsBridge.getFeedStatus('B'),
      C: wsBridge.getFeedStatus('C'),
      D: wsBridge.getFeedStatus('D'),
      E: wsBridge.getFeedStatus('E')
    }
  });
});

/**
 * Generate demo patient code (ephemeral)
 */
app.get('/demo/patient', (_req: Request, res: Response) => {
  const patientCode = generateEphemeralPatientCode();
  res.json({
    patientCode,
    message: 'Ephemeral patient code generated'
  });
});

/**
 * DOM recognition - bind patient to transcript (Phase 2)
 */
app.post('/dom', async (req: Request, res: Response) => {
  try {
    const { transcriptId, domMap } = req.body as {
      transcriptId: number;
      domMap: DomMap;
    };

    if (!transcriptId || !domMap) {
      res.status(400).json({ error: 'Missing transcriptId or domMap' });
      return;
    }

    // TODO: Lookup real patient UUID from EMR based on MRN
    // For now, generate a mock patient UUID
    const patientUuid = `patient-${domMap.patientHint?.mrn || 'unknown'}`;

    await updatePatientInfo(transcriptId, patientUuid, domMap);

    res.json({
      success: true,
      transcriptId,
      patientUuid,
      metadata: domMap
    });
  } catch (error: any) {
    console.error('[Server] /dom error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get latest transcript for user (for /patient/current)
 */
app.get('/patient/current', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || DEMO_DOCTOR_ID;
    
    const transcript = await getLatestTranscript(userId);
    
    if (!transcript) {
      res.status(404).json({ error: 'No transcript found for user' });
      return;
    }

    res.json(transcript);
  } catch (error: any) {
    console.error('[Server] /patient/current error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get specific transcript by ID
 */
app.get('/transcripts/:id', async (req: Request, res: Response) => {
  try {
    const transcriptId = parseInt(req.params.id);

    if (isNaN(transcriptId)) {
      res.status(400).json({ error: 'Invalid transcript ID' });
      return;
    }

    const transcript = await getTranscript(transcriptId);

    if (!transcript) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }

    res.json(transcript);
  } catch (error: any) {
    console.error('[Server] /transcripts/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all connected tabs
 */
app.get('/tabs', (_req: Request, res: Response) => {
  const tabs = tabManager.getAllTabs().map(tab => ({
    tabId: tab.tabId,
    url: tab.url,
    title: tab.title,
    patientHint: tab.patientHint,
    isActive: tab.tabId === tabManager.getActiveTabId(),
    registeredAt: tab.registeredAt,
    lastSeen: tab.lastSeen
  }));

  res.json({
    tabs,
    activeTabId: tabManager.getActiveTabId(),
    count: tabs.length
  });
});

/**
 * Get autopilot status for a tab
 */
app.get('/autopilot/:tabId', (req: Request, res: Response) => {
  const { tabId } = req.params;

  const tab = tabManager.getTab(tabId);
  if (!tab) {
    res.status(404).json({ error: 'Tab not found' });
    return;
  }

  const report = autopilot.calculateCoverage(tabId);
  res.json(report);
});

// ============================================================================
// WebSocket Setup
// ============================================================================

const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

// Session management
interface Session {
  ws: WebSocket;
  userId: string;
  tabId: string | null;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
  saveTimer: NodeJS.Timeout | null;
  fullTranscript: string;
}

const sessions = new Map<WebSocket, Session>();

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', 'http://localhost');
  const userId = url.searchParams.get('userId') || DEMO_DOCTOR_ID;

  console.log(`[Server] WebSocket connection from user: ${userId}`);

  // Create session
  const session: Session = {
    ws,
    userId,
    tabId: null,
    transcriptId: null,
    deepgram: null,
    pendingChunks: [],
    isRecording: false,
    saveTimer: null,
    fullTranscript: ''
  };

  sessions.set(ws, session);

  // Add to WsBridge for Feed status broadcasting
  wsBridge.addClient(ws);

  // Handle messages
  ws.on('message', async (data) => {
    await handleMessage(session, data);
  });

  // Handle close
  ws.on('close', () => {
    console.log(`[Server] WebSocket disconnected: ${userId}`);
    if (session.tabId) {
      tabManager.unregisterTab(session.tabId);
    }
    cleanupSession(session);
    sessions.delete(ws);
  });

  // Handle error
  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
    cleanupSession(session);
  });

  // Send welcome message
  send(ws, { type: 'connected', userId });
});

/**
 * Handle WebSocket messages
 */
async function handleMessage(session: Session, data: any): Promise<void> {
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
    await handleCommand(session, message);
  } catch (error) {
    console.error('[Server] Failed to parse message:', error);
    send(session.ws, { type: 'error', error: 'Invalid message format' });
  }
}

/**
 * Handle JSON commands
 */
async function handleCommand(session: Session, message: any): Promise<void> {
  switch (message.type) {
    // Multi-tab handshake
    case 'hello':
      await handleHello(session, message);
      break;

    case 'bind_audio':
      await handleBindAudio(session, message);
      break;

    case 'force_bind':
      await handleForceBind(session, message);
      break;

    // Recording
    case 'start_recording':
      await startRecording(session, message);
      break;

    case 'stop_recording':
      await stopRecording(session);
      break;

    // DOM and commands
    case 'dom_map':
      await handleDomMap(session, message);
      break;

    case 'command':
      await handleCommand2(session, message);
      break;

    // Heartbeat
    case 'ping':
      send(session.ws, { type: 'pong', timestamp: Date.now() });
      break;

    default:
      console.warn(`[Server] Unknown command: ${message.type}`);
  }
}

/**
 * Handle hello message - register a browser tab
 */
async function handleHello(session: Session, message: any): Promise<void> {
  const { tabId, url, title, patientHint } = message;

  if (!tabId) {
    send(session.ws, { type: 'error', error: 'Missing tabId in hello message' });
    return;
  }

  session.tabId = tabId;

  const result = tabManager.registerTab(tabId, session.ws, url || '', title || '', patientHint || null);

  send(session.ws, {
    type: 'hello_ack',
    tabId,
    isActive: result.isActive,
    activeTabId: result.activeTabId
  });

  console.log(`[Server] Tab registered: ${tabId}`);
}

/**
 * Handle bind_audio message - bind audio to a tab
 */
async function handleBindAudio(session: Session, message: any): Promise<void> {
  const tabId = session.tabId || message.tabId;

  if (!tabId) {
    send(session.ws, { type: 'error', error: 'Tab not registered. Send hello first.' });
    return;
  }

  // Generate patient code if not already recording
  const patientCode = message.patientCode || generateEphemeralPatientCode();

  // Create transcript run
  const transcriptId = await createTranscriptRun(
    session.userId,
    patientCode,
    message.patientUuid || null
  );
  session.transcriptId = transcriptId;

  const result = tabManager.bindAudio(tabId, transcriptId, patientCode);

  if (!result.success) {
    send(session.ws, {
      type: 'bind_audio_warning',
      warning: result.warning,
      previousTabId: result.previousTabId
    });
    return;
  }

  send(session.ws, {
    type: 'audio_bound',
    tabId,
    transcriptId,
    patientCode
  });

  console.log(`[Server] Audio bound to tab: ${tabId}, transcript: ${transcriptId}`);
}

/**
 * Handle force_bind message - force bind audio despite warnings
 */
async function handleForceBind(session: Session, message: any): Promise<void> {
  const tabId = session.tabId || message.tabId;

  if (!tabId) {
    send(session.ws, { type: 'error', error: 'Tab not registered. Send hello first.' });
    return;
  }

  const patientCode = message.patientCode || generateEphemeralPatientCode();

  // Create transcript run if needed
  if (!session.transcriptId) {
    const transcriptId = await createTranscriptRun(
      session.userId,
      patientCode,
      message.patientUuid || null
    );
    session.transcriptId = transcriptId;
  }

  const result = tabManager.forceBindAudio(tabId, session.transcriptId!, patientCode);

  send(session.ws, {
    type: 'audio_bound',
    tabId,
    transcriptId: session.transcriptId,
    patientCode,
    forced: true
  });
}

/**
 * Handle DOM map update from overlay
 */
async function handleDomMap(session: Session, message: any): Promise<void> {
  const tabId = session.tabId || message.tabId;

  if (!tabId) {
    send(session.ws, { type: 'error', error: 'Tab not registered' });
    return;
  }

  const domMap: DomMap = {
    fields: message.fields || [],
    patientHint: message.patientHint || null,
    timestamp: Date.now()
  };

  // Update in tab manager and command router
  commandRouter.updateDomMap(tabId, domMap);

  // Calculate autopilot coverage
  const report = autopilot.calculateCoverage(tabId);

  send(session.ws, {
    type: 'dom_map_ack',
    tabId,
    fieldCount: domMap.fields.length
  });

  // Send autopilot update
  send(session.ws, {
    type: 'autopilot',
    data: report
  });

  console.log(`[Server] DOM map received: ${domMap.fields.length} fields`);
}

/**
 * Handle command from overlay (MAP/FILL/UNDO/SEND)
 */
async function handleCommand2(session: Session, message: any): Promise<void> {
  const tabId = session.tabId || message.tabId;
  const action = message.action as CommandAction;

  if (!tabId) {
    send(session.ws, { type: 'error', error: 'Tab not registered' });
    return;
  }

  if (!action || !['map', 'fill', 'undo', 'send'].includes(action)) {
    send(session.ws, { type: 'error', error: `Invalid command action: ${action}` });
    return;
  }

  // Update transcript data for command router
  if (session.fullTranscript) {
    commandRouter.updateTranscript(tabId, {
      fullText: session.fullTranscript,
      chunks: session.pendingChunks.map(c => ({
        speaker: c.speaker || 0,
        text: c.text,
        timestamp: c.timestamp ?? Date.now()
      }))
    });
  }

  const result = await commandRouter.processCommand({
    action,
    tabId,
    payload: message.payload
  });

  send(session.ws, {
    type: 'command_result',
    ...result
  });

  console.log(`[Server] Command ${action}: ${result.success ? 'success' : 'failed'}`);
}

/**
 * Start recording
 */
async function startRecording(session: Session, message: any): Promise<void> {
  if (session.isRecording) {
    send(session.ws, { type: 'error', error: 'Already recording' });
    return;
  }

  try {
    // Generate ephemeral patient code
    const patientCode = message.patientCode || generateEphemeralPatientCode();

    // Create transcript run in Supabase
    const transcriptId = await createTranscriptRun(
      session.userId,
      patientCode,
      message.patientUuid || null
    );
    session.transcriptId = transcriptId;

    // Initialize Deepgram
    session.deepgram = new DeepgramConsumer({
      onTranscript: (event: TranscriptEvent) => {
        // Accumulate full transcript for autopilot
        if (event.isFinal) {
          session.fullTranscript += ' ' + event.text;

          // Update autopilot with new transcript
          if (session.tabId) {
            autopilot.updateTranscript(session.tabId, {
              fullText: session.fullTranscript,
              chunks: []
            });

            // Recalculate and broadcast autopilot status
            const report = autopilot.calculateCoverage(session.tabId);
            send(session.ws, { type: 'autopilot', data: report });
          }
        }

        // Broadcast transcript via WsBridge (Feed A)
        wsBridge.broadcastTranscript(
          event.text,
          event.isFinal,
          event.confidence,
          event.speaker
        );
      },
      onChunk: (chunk: TranscriptChunk) => {
        // Queue chunk for batch save
        session.pendingChunks.push(chunk);
      },
      onError: (error: Error) => {
        console.error('[Server] Deepgram error:', error);
        wsBridge.updateFeedStatus('A', 'error');
        send(session.ws, { type: 'error', error: error.message });
      },
      onClose: () => {
        wsBridge.updateFeedStatus('A', 'disconnected');
      }
    });

    await session.deepgram.connect();
    session.isRecording = true;

    // Update Feed A status
    wsBridge.updateFeedStatus('A', 'connected');

    // Start periodic save timer (every 5 seconds)
    session.saveTimer = setInterval(async () => {
      await savePendingChunks(session);
    }, 5000);

    send(session.ws, {
      type: 'recording_started',
      transcriptId,
      patientCode
    });

    console.log(`[Server] Recording started: transcript ${transcriptId}, patient code ${patientCode}`);
  } catch (error: any) {
    console.error('[Server] Failed to start recording:', error);
    send(session.ws, { type: 'error', error: error.message });
  }
}

/**
 * Stop recording
 */
async function stopRecording(session: Session): Promise<void> {
  if (!session.isRecording) {
    send(session.ws, { type: 'error', error: 'Not recording' });
    return;
  }

  try {
    // Stop Deepgram
    if (session.deepgram) {
      session.deepgram.disconnect();
      session.deepgram = null;
    }

    session.isRecording = false;

    // Stop save timer
    if (session.saveTimer) {
      clearInterval(session.saveTimer);
      session.saveTimer = null;
    }

    // Final save of pending chunks
    await savePendingChunks(session);

    // Mark transcript complete
    if (session.transcriptId) {
      await completeTranscriptRun(session.transcriptId);
    }

    // Update Feed A status
    wsBridge.updateFeedStatus('A', 'disconnected');

    send(session.ws, {
      type: 'recording_stopped',
      transcriptId: session.transcriptId
    });

    console.log(`[Server] Recording stopped: transcript ${session.transcriptId}`);
  } catch (error: any) {
    console.error('[Server] Failed to stop recording:', error);
    send(session.ws, { type: 'error', error: error.message });
  }
}

/**
 * Save pending chunks to Supabase
 */
async function savePendingChunks(session: Session): Promise<void> {
  if (!session.transcriptId || session.pendingChunks.length === 0) return;

  const chunks = [...session.pendingChunks];
  session.pendingChunks = [];

  try {
    await saveTranscriptChunks(session.transcriptId, chunks);
  } catch (error) {
    // Re-queue chunks on failure
    session.pendingChunks.unshift(...chunks);
    console.error('[Server] Failed to save chunks, will retry:', error);
  }
}

/**
 * Cleanup session
 */
function cleanupSession(session: Session): void {
  if (session.deepgram) {
    session.deepgram.disconnect();
  }
  if (session.saveTimer) {
    clearInterval(session.saveTimer);
  }
  if (session.transcriptId) {
    savePendingChunks(session);
  }
}

/**
 * Send message to WebSocket client
 */
function send(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ============================================================================
// Server Startup
// ============================================================================

server.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('   AssistMD Truth Package - CNS Agent');
  console.log('========================================');
  console.log(`   Port:      ${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`   Demo:      http://localhost:${PORT}/demo/patient`);
  console.log('========================================');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

export { app, server, wsBridge };
