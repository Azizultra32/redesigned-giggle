/**
 * AssistMD Ghost System - CNS Agent Server
 *
 * Express server with WebSocket support for:
 * - /ws: WebSocket with Feed A-E model + multi-tab support
 * - /health: Health check
 * - /dom: DOM recognition for patient binding
 * - /patient/current: Get latest transcript for user
 * - /transcripts/:id: Get specific transcript
 * - /autopilot/:tabId: Get autopilot coverage report
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { WsBridge } from './lib/ws-bridge.js';
import { DeepgramConsumer } from './audio/deepgram-consumer.js';
import { commandRouter, Command } from './lib/command-router.js';
import { autopilot } from './lib/autopilot.js';
import { tabManager, TabHello, TabBindAudio } from './lib/tab-manager.js';
import {
  createTranscriptRun,
  saveTranscriptChunks,
  completeTranscriptRun,
  updatePatientInfo,
  getTranscript,
  getLatestTranscript,
  generateEphemeralPatientCode
} from './lib/supabase.js';
import { TranscriptChunk, TranscriptEvent, DomMap } from './types/index.js';

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
// HTTP Endpoints
// ============================================================================

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  const tabStats = tabManager.getStats();
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
    },
    tabs: {
      total: tabStats.totalTabs,
      active: tabStats.activeTabId,
      patients: tabStats.uniquePatients
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
    const { transcriptId, domMap, tabId } = req.body as {
      transcriptId: number;
      domMap: DomMap;
      tabId?: string;
    };

    if (!transcriptId || !domMap) {
      res.status(400).json({ error: 'Missing transcriptId or domMap' });
      return;
    }

    // Update tab manager if tabId provided
    if (tabId) {
      tabManager.updateDomMap(tabId, domMap);
      commandRouter.updateDomMap(tabId, domMap);
    }

    // TODO: Lookup real patient UUID from EMR based on MRN
    const patientUuid = `patient-${domMap.mrn || 'unknown'}`;

    await updatePatientInfo(transcriptId, patientUuid, domMap);

    // Calculate autopilot coverage if tabId provided
    let coverage = null;
    if (tabId) {
      coverage = autopilot.calculateCoverage(tabId, domMap);
    }

    res.json({
      success: true,
      transcriptId,
      patientUuid,
      metadata: domMap,
      autopilot: coverage
    });
  } catch (error: any) {
    console.error('[Server] /dom error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get autopilot coverage for a tab
 */
app.get('/autopilot/:tabId', (req: Request, res: Response) => {
  const { tabId } = req.params;

  const report = autopilot.getLastReport(tabId);
  if (!report) {
    res.status(404).json({ error: 'No autopilot data for this tab' });
    return;
  }

  const trend = autopilot.getCoverageTrend(tabId);
  const signoffStatus = autopilot.isReadyForSignoff(tabId);

  res.json({
    ...report,
    trend,
    signoff: signoffStatus
  });
});

/**
 * Get latest transcript for user
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
  const tabs = tabManager.getAllTabs().map(t => ({
    tabId: t.tabId,
    url: t.url,
    title: t.title,
    isActive: t.isActive,
    patientHint: t.patientHint,
    transcriptId: t.transcriptId
  }));

  res.json({ tabs });
});

// ============================================================================
// WebSocket Setup
// ============================================================================

const server = createServer(app);

// Initialize WsBridge
const wsBridge = new WsBridge();

// WebSocket server
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

// Session management (per WebSocket connection)
interface Session {
  ws: WebSocket;
  userId: string;
  tabId: string | null;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
  saveTimer: NodeJS.Timeout | null;
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
    saveTimer: null
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
    // Tab management
    case 'hello':
      handleHello(session, message as TabHello);
      break;

    case 'bind_audio':
      handleBindAudio(session, message as TabBindAudio);
      break;

    case 'force_bind':
      handleForceBind(session, message);
      break;

    // Recording
    case 'start_recording':
      await startRecording(session, message);
      break;

    case 'stop_recording':
      await stopRecording(session);
      break;

    // Command pipeline
    case 'command':
      await handleCommandPipeline(session, message);
      break;

    // DOM mapping
    case 'dom_map':
      handleDomMap(session, message);
      break;

    // Utility
    case 'ping':
      send(session.ws, { type: 'pong', timestamp: Date.now() });
      break;

    default:
      console.warn(`[Server] Unknown command: ${message.type}`);
  }
}

/**
 * Handle tab hello (registration)
 */
function handleHello(session: Session, message: TabHello): void {
  const tabSession = tabManager.registerTab(message, session.ws);
  session.tabId = message.tabId;

  // Send confirmation with current active tab info
  const activeTab = tabManager.getActiveTab();
  send(session.ws, {
    type: 'hello_ack',
    tabId: message.tabId,
    activeTab: activeTab ? {
      tabId: activeTab.tabId,
      url: activeTab.url,
      patientHint: activeTab.patientHint
    } : null
  });
}

/**
 * Handle bind audio request
 */
function handleBindAudio(session: Session, message: TabBindAudio): void {
  const result = tabManager.bindAudio(message.tabId);

  if (result.warning) {
    // Patient mismatch - send warning, let client decide
    send(session.ws, result.warning);
    return;
  }

  if (result.success) {
    send(session.ws, {
      type: 'audio_bound',
      tabId: message.tabId
    });
  } else {
    send(session.ws, {
      type: 'error',
      error: 'Failed to bind audio'
    });
  }
}

/**
 * Handle force bind (override patient mismatch)
 */
function handleForceBind(session: Session, message: any): void {
  const success = tabManager.forceBind(message.tabId);
  send(session.ws, {
    type: success ? 'audio_bound' : 'error',
    tabId: message.tabId,
    forced: true
  });
}

/**
 * Handle command pipeline (map/fill/undo/send)
 */
async function handleCommandPipeline(session: Session, message: any): Promise<void> {
  const { action, payload } = message;
  const tabId = session.tabId || message.tabId;

  if (!tabId) {
    send(session.ws, {
      type: 'command_result',
      success: false,
      error: 'No tab ID associated with this session'
    });
    return;
  }

  const command: Command = {
    type: action,
    tabId,
    payload
  };

  const result = await commandRouter.execute(command, session.ws);

  // If DOM map was included, calculate autopilot
  if (action === 'map' && payload && result.success) {
    const coverage = autopilot.calculateCoverage(tabId, payload);

    // Broadcast autopilot update
    wsBridge.broadcast({
      type: 'autopilot',
      data: {
        tabId,
        status: coverage.status,
        score: coverage.score,
        suggestions: coverage.suggestions
      }
    });
  }

  send(session.ws, {
    type: 'command_result',
    ...result
  });
}

/**
 * Handle DOM map update
 */
function handleDomMap(session: Session, message: any): void {
  const { tabId, domMap } = message;
  const effectiveTabId = tabId || session.tabId;

  if (!effectiveTabId) {
    send(session.ws, { type: 'error', error: 'No tab ID for DOM map' });
    return;
  }

  tabManager.updateDomMap(effectiveTabId, domMap);
  commandRouter.updateDomMap(effectiveTabId, domMap);

  // Calculate autopilot coverage
  const coverage = autopilot.calculateCoverage(effectiveTabId, domMap);

  send(session.ws, {
    type: 'dom_map_ack',
    tabId: effectiveTabId,
    fieldsCount: domMap.fields?.length || 0,
    autopilot: {
      status: coverage.status,
      score: coverage.score,
      suggestions: coverage.suggestions
    }
  });
}

/**
 * Start recording
 */
async function startRecording(session: Session, message: any): Promise<void> {
  if (session.isRecording) {
    send(session.ws, { type: 'error', error: 'Already recording' });
    return;
  }

  // Check if this tab is the active audio tab
  const activeTab = tabManager.getActiveTab();
  if (session.tabId && activeTab && activeTab.tabId !== session.tabId) {
    send(session.ws, {
      type: 'error',
      error: `Audio is bound to another tab. Call bind_audio first.`,
      activeTabId: activeTab.tabId
    });
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

    // Update tab manager
    if (session.tabId) {
      tabManager.setTranscriptId(session.tabId, transcriptId);
    }

    // Initialize Deepgram
    session.deepgram = new DeepgramConsumer({
      onTranscript: (event: TranscriptEvent) => {
        // Broadcast transcript via WsBridge (Feed A)
        // Include tabId so clients can filter
        const transcriptMsg = {
          type: 'transcript',
          data: {
            feed: 'A' as const,
            tabId: session.tabId,
            text: event.text,
            isFinal: event.isFinal,
            confidence: event.confidence,
            speaker: event.speaker,
            timestamp: new Date().toISOString()
          }
        };
        wsBridge.broadcast(transcriptMsg);
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
      patientCode,
      tabId: session.tabId
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
  if (session.tabId) {
    tabManager.unregisterTab(session.tabId);
    commandRouter.clearTab(session.tabId);
    autopilot.clearTab(session.tabId);
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
// Periodic Cleanup
// ============================================================================

// Clean up stale tabs every 5 minutes
setInterval(() => {
  tabManager.cleanupStaleTabs(30 * 60 * 1000); // 30 minutes
}, 5 * 60 * 1000);

// ============================================================================
// Server Startup
// ============================================================================

server.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('   AssistMD Ghost System - CNS Agent');
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

export { app, server, wsBridge, tabManager, commandRouter, autopilot };
