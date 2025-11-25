/**
 * Bridge Module
 *
 * Handles messaging between the overlay (Anchor) and the backend agent.
 * Provides an event-driven API for components to communicate.
 */

export type BridgeEventType =
  | 'transcript'
  | 'connection'
  | 'patient'
  | 'start-recording'
  | 'stop-recording'
  | 'recording-started'
  | 'recording-stopped'
  | 'recording-error'
  | 'audio-status'
  | 'map-fields'
  | 'fields-detected'
  | 'fields-changed'
  | 'get-patient-info'
  | 'server-error'
  | 'toggle-overlay';

type EventCallback<T = unknown> = (data: T) => void | Promise<void>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class Bridge {
  private listeners: Map<BridgeEventType, Set<EventCallback>> = new Map();
  private port: chrome.runtime.Port | null = null;
  private _isConnected: boolean = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageIdCounter: number = 0;
  private reconnectInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.setupListeners();
  }

  /**
   * Connect to the background service worker
   */
  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[Bridge] Connecting to background service worker...');

        this.port = chrome.runtime.connect({ name: 'ghost-next-overlay' });

        this.port.onMessage.addListener((message) => {
          this.handleMessage(message);
        });

        this.port.onDisconnect.addListener(() => {
          console.log('[Bridge] Disconnected from background');
          this._isConnected = false;
          this.emit('connection', { connected: false });
          this.attemptReconnect();
        });

        this._isConnected = true;
        this.emit('connection', { connected: true });

        console.log('[Bridge] Connected to background service worker');
        resolve();
      } catch (error) {
        console.error('[Bridge] Failed to connect:', error);
        reject(error);
      }
    });
  }

  /**
   * Check if bridge is connected
   */
  public isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Register an event listener
   */
  public on<T = unknown>(event: BridgeEventType, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(callback as EventCallback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback);
    };
  }

  /**
   * Remove an event listener
   */
  public off(event: BridgeEventType, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Emit an event to all listeners and optionally send to background
   */
  public async emit(event: BridgeEventType, data: unknown): Promise<void> {
    // Notify local listeners
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          await callback(data);
        } catch (error) {
          console.error(`[Bridge] Error in ${event} listener:`, error);
        }
      }
    }

    // Send to background if connected
    if (this._isConnected && this.port) {
      this.port.postMessage({
        type: event,
        data,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Send a request and wait for response
   */
  public async request<T = unknown>(
    event: BridgeEventType,
    data: unknown,
    timeoutMs: number = 10000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const messageId = `${++this.messageIdCounter}_${Date.now()}`;

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request ${event} timed out`));
      }, timeoutMs);

      this.pendingRequests.set(messageId, { resolve: resolve as (value: unknown) => void, reject, timeout });

      if (this._isConnected && this.port) {
        this.port.postMessage({
          type: event,
          data,
          messageId,
          timestamp: Date.now()
        });
      } else {
        clearTimeout(timeout);
        this.pendingRequests.delete(messageId);
        reject(new Error('Not connected to background'));
      }
    });
  }

  private handleMessage(message: {
    type: string;
    data?: unknown;
    messageId?: string;
    error?: string;
  }): void {
    console.log('[Bridge] Received message:', message.type);

    // Handle response to pending request
    if (message.messageId && this.pendingRequests.has(message.messageId)) {
      const pending = this.pendingRequests.get(message.messageId)!;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.messageId);

      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.data);
      }
      return;
    }

    // Emit event to local listeners
    if (message.type) {
      this.emit(message.type as BridgeEventType, message.data);
    }
  }

  private setupListeners(): void {
    // Listen for messages from the page (for cross-origin communication)
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;

      const message = event.data;
      if (message?.source === 'ghost-next-page') {
        this.handleMessage(message);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectInterval) return;

    console.log('[Bridge] Starting reconnection attempts...');

    this.reconnectInterval = setInterval(async () => {
      try {
        await this.connect();
        if (this.reconnectInterval) {
          clearInterval(this.reconnectInterval);
          this.reconnectInterval = null;
        }
      } catch (error) {
        console.log('[Bridge] Reconnection attempt failed');
      }
    }, 5000);
  }

  /**
   * Disconnect and cleanup
   */
  public disconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }

    this._isConnected = false;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Bridge disconnected'));
    }
    this.pendingRequests.clear();

    // Clear all listeners
    this.listeners.clear();
  }
}
