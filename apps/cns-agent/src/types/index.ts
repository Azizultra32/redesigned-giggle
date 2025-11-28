/**
 * AssistMD Truth Package - Type Definitions
 * 
 * All interfaces for the CNS Agent system
 */

// ============================================================================
// Deepgram & Audio
// ============================================================================

export interface WordResult {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: number;
}

export interface TranscriptEvent {
  type: 'interim' | 'final' | 'utterance_end';
  text: string;
  speaker: number;
  start: number;
  end: number;
  confidence: number;
  words: WordResult[];
  isFinal: boolean;
}

// ============================================================================
// Transcript Chunks
// ============================================================================

export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw: WordResult[];
  timestamp?: number;
}

// ============================================================================
// WebSocket Feed Model (A-E)
// ============================================================================

export type FeedId = 'A' | 'B' | 'C' | 'D' | 'E';
export type FeedStatus = 'connected' | 'disconnected' | 'ready' | 'error';

export interface FeedInfo {
  feed: FeedId;
  label: string;
  status: FeedStatus;
  timestamp: string;
}

export interface StatusMessage {
  type: 'status';
  data: FeedInfo;
}

export interface TranscriptMessage {
  type: 'transcript';
  data: {
    feed: FeedId;
    text: string;
    isFinal: boolean;
    confidence: number;
    speaker: number;
    timestamp: string;
  };
}

export interface AlertMessage {
  type: 'alert';
  data: {
    feed: FeedId;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    keywords?: string[];
    timestamp: string;
  };
}

export interface CommandPayload {
  intent?: string;
  target?: string;
  data?: Record<string, unknown>;
}

export interface CommandMessage {
  type: 'command';
  data: {
    feed: FeedId;
    command: 'trigger_map' | 'smart_fill' | 'undo_fill' | 'dictate';
    payload?: CommandPayload;
    timestamp: string;
  };
}

export interface ActiveTabChangedMessage {
  type: 'active_tab_changed';
  tabId: string | null;
  timestamp: number;
}

export type WsMessage = StatusMessage | TranscriptMessage | AlertMessage | CommandMessage | ActiveTabChangedMessage;

// ============================================================================
// Supabase Schema (transcripts2 table)
// ============================================================================

export interface TranscriptRun {
  id: number; // BIGINT
  user_id: string; // UUID
  patient_code: string; // Ephemeral ID like "PT-A1B2-C3D4"
  patient_uuid?: string | null; // Real patient UUID (optional)
  transcript?: string; // Full flattened text
  transcript_chunk?: TranscriptChunk[]; // JSONB array
  created_at?: string; // timestamptz
  completed_at?: string | null; // timestamptz
  metadata?: any; // JSONB
  ai_summary?: string;
  ai_short_summary?: string;
  ai_interim_summaries?: any[];
  pii_mapping?: any;
  token_count?: number;
  language?: string;
}

// ============================================================================
// Patient Identity (Two-Phase)
// ============================================================================

export interface EphemeralPatient {
  patient_code: string; // e.g., "PT-A1B2-C3D4"
  patient_uuid: null;
}

export interface BoundPatient {
  patient_code: string; // Still the same ephemeral code
  patient_uuid: string; // Real patient UUID from EMR
  metadata: {
    mrn?: string;
    name?: string;
    dob?: string;
  };
}

// ============================================================================
// DOM Recognition
// ============================================================================

export interface DomMap {
  mrn?: string;
  name?: string;
  dob?: string;
  encounterDate?: string;
  [key: string]: any;
}

// ============================================================================
// Session & Configuration
// ============================================================================

export interface SessionConfig {
  transcriptId: number;
  userId: string;
  patientCode: string;
  patientUuid?: string | null;
}
