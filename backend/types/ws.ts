/**
 * WebSocket Message Types
 *
 * Canonical type definitions for all WebSocket messages.
 * Per OpenSpec: All messages use `kind` field, NOT `type`.
 */

// ─────────────────────────────────────────────
// Message Kinds
// ─────────────────────────────────────────────

/**
 * All valid WebSocket message kinds
 */
export type MessageKind =
  // Connection lifecycle
  | 'connected'
  | 'error'
  | 'redirect'
  | 'pong'
  // Recording
  | 'recording_started'
  | 'recording_stopped'
  | 'deepgram_closed'
  // Feed A: Transcription
  | 'transcript'
  | 'chunk'
  | 'feed_status'
  // Feed B: Voice Commands
  | 'voice_command'
  | 'command_request'
  // Feed C: Emergency
  | 'alert'
  // Feed D: Autopilot
  | 'status'
  // Feed E: Consent
  | 'consent_logged'
  // Feed F: Audio Response
  | 'audio_response'
  | 'assist_triggered'
  // Patient
  | 'patient_set'
  // Multi-window
  | 'leader_changed'
  | 'state_sync'
  | 'transcript_sync';

/**
 * Base WebSocket message interface
 */
export interface WsMessage {
  kind: MessageKind;
  feed?: FeedId;
  timestamp?: number;
}

// ─────────────────────────────────────────────
// Client Types
// ─────────────────────────────────────────────

/**
 * WebSocket client connection types
 */
export type ClientType = 'overlay' | 'dashboard' | 'agent' | 'mcp';

/**
 * Feed identifiers (A-F)
 */
export type FeedId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/**
 * Client metadata for registration
 */
export interface ClientMetadata {
  userAgent?: string;
  version?: string;
  windowId?: string;
  tabId?: number;
}

/**
 * Registered WebSocket client
 */
export interface RegisteredClient {
  id: string;
  type: ClientType;
  doctorId: string | null;
  subscribedFeeds: Set<FeedId>;
  subscribedTopics: Set<string>;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number;
  metadata: ClientMetadata;
}

/**
 * Options for broadcasting messages
 */
export interface BroadcastOptions {
  feed?: FeedId;
  topic?: string;
  clientTypes?: ClientType[];
  doctorId?: string;
  excludeClientIds?: string[];
}

/**
 * Result of a broadcast operation
 */
export interface BroadcastResult {
  targetCount: number;
  sent: number;
  failed: number;
  errors?: Array<{ clientId: string; error: string }>;
}

/**
 * Client registry statistics
 */
export interface RegistryStats {
  totalClients: number;
  byType: Record<ClientType, number>;
  byFeed: Record<FeedId, number>;
  totalDoctors: number;
  totalTopics: number;
}

// ─────────────────────────────────────────────
// Incoming Message Types (from client)
// ─────────────────────────────────────────────

export type IncomingMessageKind =
  | 'start_recording'
  | 'stop_recording'
  | 'set_patient'
  | 'command'
  | 'dom_map_result'
  | 'ping';

export interface IncomingMessage {
  kind: IncomingMessageKind;
  [key: string]: unknown;
}
