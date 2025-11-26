/**
 * Error Handling Module (PATH O)
 *
 * Centralized error handling for all layers.
 * Maps errors to user-friendly messages and Feed A alerts.
 */

export type ErrorLayer = 'extension' | 'backend' | 'deepgram' | 'supabase' | 'websocket';

export interface LayerError {
  layer: ErrorLayer;
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
  timestamp: number;
  details?: Record<string, unknown>;
}

// Error codes by layer
export const ERROR_CODES = {
  extension: {
    WS_CLOSED: 'EXT_WS_CLOSED',
    AUDIO_ERROR: 'EXT_AUDIO_ERROR',
    DOM_MISSING: 'EXT_DOM_MISSING',
    PERMISSION_DENIED: 'EXT_PERMISSION_DENIED'
  },
  backend: {
    DEEPGRAM_ERROR: 'BE_DEEPGRAM_ERROR',
    SUPABASE_ERROR: 'BE_SUPABASE_ERROR',
    WS_ERROR: 'BE_WS_ERROR',
    SESSION_NOT_FOUND: 'BE_SESSION_NOT_FOUND'
  },
  deepgram: {
    CONNECTION_FAILED: 'DG_CONNECTION_FAILED',
    TIMEOUT: 'DG_TIMEOUT',
    RATE_LIMITED: 'DG_RATE_LIMITED',
    INVALID_AUDIO: 'DG_INVALID_AUDIO'
  },
  supabase: {
    TABLE_MISSING: 'SB_42P01',
    RLS_DENIED: 'SB_RLS_DENIED',
    CONNECTION_FAILED: 'SB_CONNECTION_FAILED',
    QUERY_ERROR: 'SB_QUERY_ERROR'
  },
  websocket: {
    CONNECTION_CLOSED: 'WS_CLOSED',
    MESSAGE_PARSE_ERROR: 'WS_PARSE_ERROR',
    SEND_FAILED: 'WS_SEND_FAILED'
  }
} as const;

// User-friendly messages
const USER_MESSAGES: Record<string, string> = {
  [ERROR_CODES.extension.WS_CLOSED]: 'Connection lost. Reconnecting...',
  [ERROR_CODES.extension.AUDIO_ERROR]: 'Microphone error. Check permissions.',
  [ERROR_CODES.extension.DOM_MISSING]: 'Form fields not found on page.',
  [ERROR_CODES.extension.PERMISSION_DENIED]: 'Permission denied. Please allow access.',

  [ERROR_CODES.backend.DEEPGRAM_ERROR]: 'Transcription service error.',
  [ERROR_CODES.backend.SUPABASE_ERROR]: 'Database error. Working offline.',
  [ERROR_CODES.backend.WS_ERROR]: 'Server connection error.',
  [ERROR_CODES.backend.SESSION_NOT_FOUND]: 'Session expired. Please reconnect.',

  [ERROR_CODES.deepgram.CONNECTION_FAILED]: 'Could not connect to transcription.',
  [ERROR_CODES.deepgram.TIMEOUT]: 'Transcription timed out.',
  [ERROR_CODES.deepgram.RATE_LIMITED]: 'Too many requests. Please wait.',
  [ERROR_CODES.deepgram.INVALID_AUDIO]: 'Invalid audio format.',

  [ERROR_CODES.supabase.TABLE_MISSING]: 'Database table missing.',
  [ERROR_CODES.supabase.RLS_DENIED]: 'Access denied. Check permissions.',
  [ERROR_CODES.supabase.CONNECTION_FAILED]: 'Database offline. Working locally.',
  [ERROR_CODES.supabase.QUERY_ERROR]: 'Database query failed.',

  [ERROR_CODES.websocket.CONNECTION_CLOSED]: 'Connection closed.',
  [ERROR_CODES.websocket.MESSAGE_PARSE_ERROR]: 'Invalid message received.',
  [ERROR_CODES.websocket.SEND_FAILED]: 'Failed to send message.'
};

/**
 * Create a standardized layer error
 */
export function createError(
  layer: ErrorLayer,
  code: string,
  message: string,
  recoverable = true,
  details?: Record<string, unknown>
): LayerError {
  return {
    layer,
    code,
    message,
    userMessage: USER_MESSAGES[code] || message,
    recoverable,
    timestamp: Date.now(),
    details
  };
}

/**
 * Create Feed A alert broadcast for error
 */
export function createErrorBroadcast(error: LayerError): object {
  return {
    kind: 'error',
    feed: 'A',
    error: {
      layer: error.layer,
      code: error.code,
      message: error.userMessage,
      recoverable: error.recoverable,
      timestamp: error.timestamp
    }
  };
}

/**
 * Parse Supabase error to standardized error
 */
export function parseSupabaseError(error: any): LayerError {
  const code = error?.code;

  if (code === '42P01') {
    return createError('supabase', ERROR_CODES.supabase.TABLE_MISSING,
      'Table does not exist', false);
  }

  if (code === 'PGRST301' || error?.message?.includes('RLS')) {
    return createError('supabase', ERROR_CODES.supabase.RLS_DENIED,
      'Row level security denied', true);
  }

  if (error?.message?.includes('connection') || error?.message?.includes('network')) {
    return createError('supabase', ERROR_CODES.supabase.CONNECTION_FAILED,
      'Database connection failed', true);
  }

  return createError('supabase', ERROR_CODES.supabase.QUERY_ERROR,
    error?.message || 'Unknown database error', true, { originalError: error });
}

/**
 * Parse Deepgram error to standardized error
 */
export function parseDeepgramError(error: any): LayerError {
  const message = error?.message?.toLowerCase() || '';

  if (message.includes('timeout')) {
    return createError('deepgram', ERROR_CODES.deepgram.TIMEOUT,
      'Connection timeout', true);
  }

  if (message.includes('rate') || message.includes('429')) {
    return createError('deepgram', ERROR_CODES.deepgram.RATE_LIMITED,
      'Rate limited', true);
  }

  if (message.includes('audio') || message.includes('format')) {
    return createError('deepgram', ERROR_CODES.deepgram.INVALID_AUDIO,
      'Invalid audio format', false);
  }

  return createError('deepgram', ERROR_CODES.deepgram.CONNECTION_FAILED,
    error?.message || 'Deepgram connection failed', true);
}

/**
 * Error handler for WebSocket broker
 */
export class ErrorHandler {
  private errors: LayerError[] = [];
  private maxErrors = 100;
  private onError: ((error: LayerError) => void) | null = null;

  constructor(onError?: (error: LayerError) => void) {
    this.onError = onError || null;
  }

  handle(error: LayerError): void {
    this.errors.push(error);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    console.error(`[${error.layer}] ${error.code}: ${error.message}`);

    if (this.onError) {
      this.onError(error);
    }
  }

  getRecent(count = 10): LayerError[] {
    return this.errors.slice(-count);
  }

  clear(): void {
    this.errors = [];
  }
}
