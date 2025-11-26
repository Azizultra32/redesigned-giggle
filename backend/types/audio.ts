/**
 * Audio & Transcription Types
 *
 * Types related to Deepgram, VAD, and audio processing.
 */

// ─────────────────────────────────────────────
// Deepgram Types
// ─────────────────────────────────────────────

/**
 * Word-level result from Deepgram
 */
export interface WordResult {
  word: string;
  start?: number;
  end?: number;
  speaker?: number;
  confidence?: number;
  punctuated_word?: string;
}

/**
 * Transcript event emitted from Deepgram consumer
 */
export interface TranscriptEvent {
  text: string;
  speaker: number;
  isFinal: boolean;
  start: number;
  end: number;
  confidence?: number;
}

/**
 * Connection state for Deepgram
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * Reconnection configuration
 */
export interface ReconnectConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Connection statistics
 */
export interface ConnectionStats {
  state: ConnectionState;
  connectAttempts: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  totalReconnects: number;
}

// ─────────────────────────────────────────────
// Chunk Aggregation Types
// ─────────────────────────────────────────────

/**
 * Aggregated transcript chunk (≤30s, speaker-bounded)
 */
export interface AggregatedChunk {
  speaker: number | null;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw?: WordResult[];
}

/**
 * Configuration for chunk aggregator
 */
export interface ChunkAggregatorConfig {
  maxDurationSec: number;
  onChunk?: (chunk: AggregatedChunk) => void;
}

// ─────────────────────────────────────────────
// VAD Types
// ─────────────────────────────────────────────

/**
 * Emergency alert severity levels
 */
export type EmergencySeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Emergency alert from VAD
 */
export interface EmergencyAlert {
  phrase: string;
  severity: EmergencySeverity;
  timestamp: number;
  context: string;
}

/**
 * VAD configuration
 */
export interface VADConfig {
  onEmergency: (alert: EmergencyAlert) => void;
}
