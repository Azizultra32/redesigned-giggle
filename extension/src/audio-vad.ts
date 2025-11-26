/**
 * Audio VAD Module (Voice Activity Detection)
 *
 * Client-side speech detection using:
 * - Silero VAD (when available via @ricky0123/vad-web)
 * - Fallback: Volume-based detection
 *
 * Used for:
 * - UI feedback (green glow when speaking)
 * - Gating "Assist" wake word detection
 * - Future: Only stream audio when speech detected
 */

import { Bridge } from './bridge';

export type VADState = 'idle' | 'listening' | 'speech';

export interface VADConfig {
  /** Volume threshold for fallback detection (0-1) */
  volumeThreshold?: number;
  /** Debounce time in ms to avoid flickering */
  debounceMs?: number;
  /** Use Silero if available */
  useSilero?: boolean;
}

const DEFAULT_CONFIG: VADConfig = {
  volumeThreshold: 0.02,
  debounceMs: 150,
  useSilero: true
};

export class AudioVAD {
  private bridge: Bridge;
  private config: VADConfig;
  private state: VADState = 'idle';

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;

  private sileroVAD: any = null;
  private usingSilero = false;

  private speechTimeout: ReturnType<typeof setTimeout> | null = null;
  private animationFrame: number | null = null;

  private onSpeechStart: (() => void) | null = null;
  private onSpeechEnd: (() => void) | null = null;
  private onStateChange: ((state: VADState) => void) | null = null;

  constructor(bridge: Bridge, config: Partial<VADConfig> = {}) {
    this.bridge = bridge;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start VAD with the given media stream
   */
  async start(stream: MediaStream): Promise<void> {
    this.mediaStream = stream;
    this.state = 'listening';
    this.emitStateChange();

    // Try to initialize Silero VAD
    if (this.config.useSilero) {
      try {
        await this.initSilero(stream);
        console.log('[VAD] Using Silero VAD');
        return;
      } catch (error) {
        console.warn('[VAD] Silero not available, using volume fallback:', error);
      }
    }

    // Fallback to volume-based detection
    this.initVolumeFallback(stream);
    console.log('[VAD] Using volume-based detection');
  }

  /**
   * Stop VAD
   */
  stop(): void {
    this.state = 'idle';
    this.emitStateChange();

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.speechTimeout) {
      clearTimeout(this.speechTimeout);
      this.speechTimeout = null;
    }

    if (this.sileroVAD) {
      try {
        this.sileroVAD.destroy?.();
      } catch {}
      this.sileroVAD = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.mediaStream = null;
    this.usingSilero = false;
  }

  /**
   * Get current state
   */
  getState(): VADState {
    return this.state;
  }

  /**
   * Register callbacks
   */
  onSpeech(callbacks: {
    onStart?: () => void;
    onEnd?: () => void;
    onStateChange?: (state: VADState) => void;
  }): void {
    this.onSpeechStart = callbacks.onStart || null;
    this.onSpeechEnd = callbacks.onEnd || null;
    this.onStateChange = callbacks.onStateChange || null;
  }

  /**
   * Initialize Silero VAD (if @ricky0123/vad-web is available)
   */
  private async initSilero(stream: MediaStream): Promise<void> {
    // Dynamic import to avoid bundling issues
    const { MicVAD } = await import('@ricky0123/vad-web');

    this.sileroVAD = await MicVAD.new({
      stream,
      onSpeechStart: () => {
        this.handleSpeechStart();
      },
      onSpeechEnd: () => {
        this.handleSpeechEnd();
      },
      // Use default Silero model settings
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.3,
      redemptionFrames: 8
    });

    this.sileroVAD.start();
    this.usingSilero = true;
  }

  /**
   * Fallback: Volume-based speech detection
   */
  private initVolumeFallback(stream: MediaStream): void {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    let isSpeaking = false;

    const detect = () => {
      if (!this.analyser || this.state === 'idle') return;

      this.analyser.getByteFrequencyData(dataArray);

      // Calculate average volume
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const normalized = average / 255;

      const threshold = this.config.volumeThreshold || 0.02;
      const nowSpeaking = normalized > threshold;

      if (nowSpeaking && !isSpeaking) {
        isSpeaking = true;
        this.handleSpeechStart();
      } else if (!nowSpeaking && isSpeaking) {
        // Debounce speech end
        if (!this.speechTimeout) {
          this.speechTimeout = setTimeout(() => {
            isSpeaking = false;
            this.handleSpeechEnd();
            this.speechTimeout = null;
          }, this.config.debounceMs || 150);
        }
      } else if (nowSpeaking && this.speechTimeout) {
        // Cancel pending speech end
        clearTimeout(this.speechTimeout);
        this.speechTimeout = null;
      }

      this.animationFrame = requestAnimationFrame(detect);
    };

    this.animationFrame = requestAnimationFrame(detect);
  }

  private handleSpeechStart(): void {
    if (this.state === 'speech') return;

    this.state = 'speech';
    this.emitStateChange();

    if (this.onSpeechStart) {
      this.onSpeechStart();
    }

    // Emit to bridge for other components
    this.bridge.emit('audio-status', { speaking: true });
  }

  private handleSpeechEnd(): void {
    if (this.state !== 'speech') return;

    this.state = 'listening';
    this.emitStateChange();

    if (this.onSpeechEnd) {
      this.onSpeechEnd();
    }

    // Emit to bridge for other components
    this.bridge.emit('audio-status', { speaking: false });
  }

  private emitStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.state);
    }
  }
}
