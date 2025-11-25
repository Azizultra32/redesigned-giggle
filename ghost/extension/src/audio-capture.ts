/**
 * Audio Capture Module
 *
 * Handles browser audio recording using the Web Audio API.
 * Captures PCM audio data and streams it via websocket to the agent.
 */

import { Bridge } from './bridge';

export interface AudioCaptureConfig {
  sampleRate: number;
  channels: number;
  bufferSize: number;
  websocketUrl: string;
}

const DEFAULT_CONFIG: AudioCaptureConfig = {
  sampleRate: 16000,        // Deepgram preferred rate
  channels: 1,              // Mono audio
  bufferSize: 4096,         // Buffer size for processing
  websocketUrl: 'ws://localhost:3001/ws'
};

export class AudioCapture {
  private config: AudioCaptureConfig;
  private bridge: Bridge;

  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private websocket: WebSocket | null = null;

  private _isRecording: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor(bridge: Bridge, config: Partial<AudioCaptureConfig> = {}) {
    this.bridge = bridge;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public async start(): Promise<void> {
    if (this._isRecording) {
      console.warn('[AudioCapture] Already recording');
      return;
    }

    console.log('[AudioCapture] Starting audio capture...');

    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channels,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate
      });

      // Connect to websocket
      await this.connectWebSocket();

      // Setup audio processing pipeline
      await this.setupAudioPipeline();

      this._isRecording = true;
      this.bridge.emit('audio-status', { recording: true });

      console.log('[AudioCapture] Audio capture started successfully');
    } catch (error) {
      console.error('[AudioCapture] Failed to start:', error);
      await this.cleanup();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this._isRecording) {
      console.warn('[AudioCapture] Not currently recording');
      return;
    }

    console.log('[AudioCapture] Stopping audio capture...');

    await this.cleanup();

    this._isRecording = false;
    this.bridge.emit('audio-status', { recording: false });

    console.log('[AudioCapture] Audio capture stopped');
  }

  public isRecording(): boolean {
    return this._isRecording;
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[AudioCapture] Connecting to ${this.config.websocketUrl}...`);

      this.websocket = new WebSocket(this.config.websocketUrl);

      this.websocket.onopen = () => {
        console.log('[AudioCapture] WebSocket connected');
        this.reconnectAttempts = 0;
        this.bridge.emit('connection', { connected: true });
        resolve();
      };

      this.websocket.onerror = (error) => {
        console.error('[AudioCapture] WebSocket error:', error);
        reject(new Error('WebSocket connection failed'));
      };

      this.websocket.onclose = (event) => {
        console.log('[AudioCapture] WebSocket closed:', event.code, event.reason);
        this.bridge.emit('connection', { connected: false });

        // Attempt reconnection if still recording
        if (this._isRecording && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        }
      };

      this.websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      // Timeout for connection
      setTimeout(() => {
        if (this.websocket?.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`[AudioCapture] Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connectWebSocket();
      } catch (error) {
        console.error('[AudioCapture] Reconnection failed:', error);
      }
    }, delay);
  }

  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'transcript':
          this.bridge.emit('transcript', {
            id: message.id || `${Date.now()}`,
            speaker: message.speaker || 'Unknown',
            text: message.text,
            timestamp: message.timestamp || Date.now(),
            isFinal: message.is_final ?? true
          });
          break;

        case 'error':
          console.error('[AudioCapture] Server error:', message.error);
          this.bridge.emit('server-error', { error: message.error });
          break;

        case 'status':
          console.log('[AudioCapture] Server status:', message);
          break;

        default:
          console.log('[AudioCapture] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[AudioCapture] Failed to parse message:', error);
    }
  }

  private async setupAudioPipeline(): Promise<void> {
    if (!this.audioContext || !this.mediaStream) {
      throw new Error('Audio context or media stream not initialized');
    }

    // Create source node from media stream
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Load and create audio worklet for processing
    try {
      await this.audioContext.audioWorklet.addModule(
        this.createWorkletBlobURL()
      );

      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor', {
        processorOptions: {
          bufferSize: this.config.bufferSize
        }
      });

      // Handle processed audio data
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio') {
          this.sendAudioData(event.data.buffer);
        }
      };

      // Connect the pipeline: source -> worklet
      this.sourceNode.connect(this.workletNode);

      console.log('[AudioCapture] Audio pipeline setup complete');
    } catch (error) {
      console.error('[AudioCapture] Failed to setup audio worklet:', error);
      // Fallback to ScriptProcessorNode (deprecated but more compatible)
      this.setupFallbackProcessor();
    }
  }

  private createWorkletBlobURL(): string {
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor(options) {
          super();
          this.bufferSize = options.processorOptions?.bufferSize || 4096;
          this.buffer = new Float32Array(this.bufferSize);
          this.bufferIndex = 0;
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (!input || !input[0]) return true;

          const channelData = input[0];

          for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferIndex++] = channelData[i];

            if (this.bufferIndex >= this.bufferSize) {
              // Convert to 16-bit PCM
              const pcmData = new Int16Array(this.bufferSize);
              for (let j = 0; j < this.bufferSize; j++) {
                const sample = Math.max(-1, Math.min(1, this.buffer[j]));
                pcmData[j] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
              }

              this.port.postMessage({
                type: 'audio',
                buffer: pcmData.buffer
              }, [pcmData.buffer]);

              this.buffer = new Float32Array(this.bufferSize);
              this.bufferIndex = 0;
            }
          }

          return true;
        }
      }

      registerProcessor('pcm-processor', PCMProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }

  private setupFallbackProcessor(): void {
    if (!this.audioContext || !this.sourceNode) {
      return;
    }

    console.log('[AudioCapture] Using fallback ScriptProcessorNode');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scriptNode = (this.audioContext as any).createScriptProcessor(
      this.config.bufferSize,
      1,
      1
    );

    scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const inputData = event.inputBuffer.getChannelData(0);

      // Convert to 16-bit PCM
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const sample = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      }

      this.sendAudioData(pcmData.buffer);
    };

    this.sourceNode.connect(scriptNode);
    scriptNode.connect(this.audioContext.destination);
  }

  private sendAudioData(buffer: ArrayBuffer): void {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(buffer);
    }
  }

  private async cleanup(): Promise<void> {
    // Stop all tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Disconnect audio nodes
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = null;
    }

    // Close websocket
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }
}
