/**
 * Feed System Types
 *
 * Types for the A-F feed system:
 * - Feed A: Transcription (Deepgram)
 * - Feed B: Voice Commands
 * - Feed C: Emergency Monitor
 * - Feed D: Autopilot
 * - Feed E: Consent Audit
 * - Feed F: Audio Response (TTS - FUTURE)
 */

// ─────────────────────────────────────────────
// Feed State Machine
// ─────────────────────────────────────────────

/**
 * Feed identifier (A-F)
 */
export type FeedId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/**
 * Feed status values
 */
export type FeedStatus =
  | 'initializing'
  | 'ready'
  | 'active'
  | 'degraded'
  | 'error'
  | 'disabled';

/**
 * Current state of a feed
 */
export interface FeedState {
  id: FeedId;
  status: FeedStatus;
  lastUpdate: number;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * Feed transition event
 */
export interface FeedTransition {
  feedId: FeedId;
  from: FeedStatus;
  to: FeedStatus;
  timestamp: number;
  reason?: string;
}

/**
 * Agent state snapshot
 */
export interface AgentState {
  feeds: Record<FeedId, FeedState>;
  lastEmergency: number | null;
  lastConsent: number | null;
  autopilotSurfaces: number;
  recording: boolean;
}

// ─────────────────────────────────────────────
// Voice Commands (Feed B)
// ─────────────────────────────────────────────

/**
 * Supported voice commands
 */
export type VoiceCommand =
  | 'scroll_down'
  | 'scroll_up'
  | 'fill_this'
  | 'map_page'
  | 'undo'
  | 'next_field'
  | 'prev_field'
  | 'submit'
  | 'cancel'
  | 'stop'
  | 'start'
  | 'assist_help'
  | 'assist_consent';

/**
 * Detected voice command
 */
export interface DetectedCommand {
  command: VoiceCommand;
  confidence: number;
  rawPhrase: string;
  timestamp: number;
}

/**
 * Voice concierge configuration
 */
export interface VoiceConciergeConfig {
  onCommand: (cmd: DetectedCommand) => void;
}

// ─────────────────────────────────────────────
// Autopilot (Feed D)
// ─────────────────────────────────────────────

/**
 * Autopilot status
 */
export type AutopilotStatus = 'OFFLINE' | 'LEARNING' | 'READY';

/**
 * DOM surface (fillable field)
 */
export interface DOMSurface {
  fieldId: string;
  label: string;
  fieldType: string;
  hasFillData: boolean;
  lastSeen: number;
}

/**
 * Autopilot state
 */
export interface AutopilotState {
  status: AutopilotStatus;
  surfaces: DOMSurface[];
  readiness: number;
  lastMapTime: number | null;
  mapCount: number;
}
