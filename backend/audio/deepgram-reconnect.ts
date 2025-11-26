/**
 * PATH V: Deepgram Reconnect + Edge Cases
 *
 * Handles:
 * - Connection loss and automatic reconnection
 * - Exponential backoff
 * - Audio buffering during reconnect
 * - Graceful degradation
 * - Rate limiting recovery
 */

import { EventEmitter } from 'events';
import { createClient, LiveClient, LiveTranscriptionEvents } from '@deepgram/sdk';

export interface ReconnectConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
  bufferDuringReconnect: boolean;
  maxBufferSize: number;
  connectionTimeout: number;
}

const DEFAULT_CONFIG: ReconnectConfig = {
  maxRetries: 5,
  baseDelay: 1000,       // 1 second
  maxDelay: 30000,       // 30 seconds
  jitter: true,
  bufferDuringReconnect: true,
  maxBufferSize: 50,     // ~50 audio chunks
  connectionTimeout: 10000
};

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'rate_limited';

export interface ConnectionStats {
  state: ConnectionState;
  connectedAt: number | null;
  disconnectedAt: number | null;
  reconnectAttempts: number;
  totalReconnects: number;
  lastError: string | null;
  bufferedChunks: number;
}

export class DeepgramReconnector extends EventEmitter {
  private client: ReturnType<typeof createClient>;
  private liveClient: LiveClient | null = null;
  private config: ReconnectConfig;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private totalReconnects = 0;
  private audioBuffer: ArrayBuffer[] = [];
  private connectedAt: number | null = null;
  private disconnectedAt: number | null = null;
  private lastError: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectionTimer: NodeJS.Timeout | null = null;

  private deepgramOptions = {
    model: 'nova-2',
    language: 'en',
    smart_format: true,
    diarize: true,
    punctuate: true,
    utterances: true,
    interim_results: true
  };

  constructor(apiKey: string, config: Partial<ReconnectConfig> = {}) {
    super();
    this.client = createClient(apiKey);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────

  public async connect(): Promise<boolean> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return this.state === 'connected';
    }

    this.setState('connecting');
    this.clearTimers();

    try {
      // Set connection timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        this.connectionTimer = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, this.config.connectionTimeout);
      });

      const connectionPromise = this.createLiveClient();

      await Promise.race([connectionPromise, timeoutPromise]);

      this.clearTimers();
      this.setState('connected');
      this.connectedAt = Date.now();
      this.disconnectedAt = null;
      this.reconnectAttempts = 0;
      this.lastError = null;

      // Flush buffered audio
      this.flushBuffer();

      return true;
    } catch (err) {
      this.clearTimers();
      this.handleConnectionError(err);
      return false;
    }
  }

  private async createLiveClient(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.liveClient = this.client.listen.live(this.deepgramOptions);

      this.liveClient.on(LiveTranscriptionEvents.Open, () => {
        this.emit('open');
        resolve();
      });

      this.liveClient.on(LiveTranscriptionEvents.Error, (err) => {
        this.handleStreamError(err);
        reject(err);
      });

      this.liveClient.on(LiveTranscriptionEvents.Close, () => {
        this.handleClose();
      });

      this.liveClient.on(LiveTranscriptionEvents.Transcript, (data) => {
        this.emit('transcript', data);
      });

      this.liveClient.on(LiveTranscriptionEvents.Metadata, (data) => {
        this.emit('metadata', data);
      });

      this.liveClient.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
        this.emit('utterance_end', data);
      });
    });
  }

  public disconnect(): void {
    this.clearTimers();
    this.setState('disconnected');
    this.disconnectedAt = Date.now();

    if (this.liveClient) {
      try {
        this.liveClient.finish();
      } catch (err) {
        // Ignore close errors
      }
      this.liveClient = null;
    }

    this.audioBuffer = [];
    this.emit('disconnected');
  }

  // ─────────────────────────────────────────────
  // Audio Handling
  // ─────────────────────────────────────────────

  public sendAudio(audio: ArrayBuffer): boolean {
    if (this.state === 'connected' && this.liveClient) {
      try {
        this.liveClient.send(audio);
        return true;
      } catch (err) {
        this.handleStreamError(err);
        return false;
      }
    }

    // Buffer audio during reconnect
    if (this.config.bufferDuringReconnect && this.state === 'reconnecting') {
      this.bufferAudio(audio);
      return false;
    }

    return false;
  }

  private bufferAudio(audio: ArrayBuffer): void {
    this.audioBuffer.push(audio);

    // Trim buffer if too large
    while (this.audioBuffer.length > this.config.maxBufferSize) {
      this.audioBuffer.shift();
      this.emit('buffer:overflow');
    }
  }

  private flushBuffer(): void {
    if (!this.liveClient || this.audioBuffer.length === 0) return;

    const buffered = this.audioBuffer.length;

    for (const chunk of this.audioBuffer) {
      try {
        this.liveClient.send(chunk);
      } catch (err) {
        this.emit('buffer:flush_error', err);
        break;
      }
    }

    this.audioBuffer = [];
    this.emit('buffer:flushed', buffered);
  }

  // ─────────────────────────────────────────────
  // Error Handling & Reconnection
  // ─────────────────────────────────────────────

  private handleConnectionError(err: unknown): void {
    const message = err instanceof Error ? err.message : 'Unknown error';
    this.lastError = message;

    // Check for rate limiting
    if (message.includes('429') || message.includes('rate')) {
      this.setState('rate_limited');
      this.emit('rate_limited');

      // Wait longer for rate limit
      setTimeout(() => {
        this.scheduleReconnect();
      }, 60000); // 1 minute
      return;
    }

    this.emit('error', err);
    this.scheduleReconnect();
  }

  private handleStreamError(err: unknown): void {
    const message = err instanceof Error ? err.message : 'Unknown error';
    this.lastError = message;
    this.emit('stream_error', err);

    if (this.state === 'connected') {
      this.disconnectedAt = Date.now();
      this.scheduleReconnect();
    }
  }

  private handleClose(): void {
    if (this.state === 'connected') {
      this.disconnectedAt = Date.now();
      this.emit('unexpected_close');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxRetries) {
      this.setState('failed');
      this.emit('reconnect:failed', {
        attempts: this.reconnectAttempts,
        lastError: this.lastError
      });
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    const delay = this.calculateBackoff();

    this.emit('reconnect:scheduled', {
      attempt: this.reconnectAttempts,
      delay,
      maxRetries: this.config.maxRetries
    });

    this.reconnectTimer = setTimeout(async () => {
      const success = await this.connect();

      if (success) {
        this.totalReconnects++;
        this.emit('reconnect:success', {
          attempt: this.reconnectAttempts,
          totalReconnects: this.totalReconnects
        });
      }
    }, delay);
  }

  private calculateBackoff(): number {
    let delay = this.config.baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    delay = Math.min(delay, this.config.maxDelay);

    if (this.config.jitter) {
      // Add up to 30% jitter
      const jitter = delay * 0.3 * Math.random();
      delay += jitter;
    }

    return Math.floor(delay);
  }

  // ─────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    const prev = this.state;
    this.state = state;

    if (prev !== state) {
      this.emit('state:change', state, prev);
    }
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public isConnected(): boolean {
    return this.state === 'connected';
  }

  public getStats(): ConnectionStats {
    return {
      state: this.state,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      totalReconnects: this.totalReconnects,
      lastError: this.lastError,
      bufferedChunks: this.audioBuffer.length
    };
  }

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  public destroy(): void {
    this.clearTimers();
    this.disconnect();
    this.removeAllListeners();
  }

  // ─────────────────────────────────────────────
  // Manual Recovery
  // ─────────────────────────────────────────────

  public async retry(): Promise<boolean> {
    if (this.state !== 'failed' && this.state !== 'rate_limited') {
      return this.state === 'connected';
    }

    this.reconnectAttempts = 0;
    this.setState('disconnected');
    return this.connect();
  }

  public resetBackoff(): void {
    this.reconnectAttempts = 0;
  }
}

export default DeepgramReconnector;
