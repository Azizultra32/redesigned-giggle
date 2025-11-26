/**
 * WebSocket Client for Dashboard
 *
 * Connects to CNS Agent backend and receives real-time updates
 * for Feeds A-E, transcripts, and system status.
 */

export type FeedId = 'A' | 'B' | 'C' | 'D' | 'E';
export type FeedStatus = 'connected' | 'disconnected' | 'error' | 'ready';

export interface FeedInfo {
  id: FeedId;
  label: string;
  status: FeedStatus;
  lastUpdate: string;
}

export interface TranscriptUpdate {
  tabId: string | null;
  text: string;
  isFinal: boolean;
  speaker: number;
  timestamp: string;
}

export interface AutopilotUpdate {
  tabId: string;
  status: 'red' | 'yellow' | 'green';
  score: number;
  suggestions: string[];
}

export interface TabInfo {
  tabId: string;
  url: string;
  title: string;
  isActive: boolean;
  patientHint?: {
    name?: string;
    mrn?: string;
  };
}

type MessageHandler = (data: any) => void;

export class DashboardWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 2000;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private isConnected = false;

  constructor(url: string = 'ws://localhost:3001/ws') {
    this.url = url;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[Dashboard WS] Already connected');
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[Dashboard WS] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connection', { connected: true });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[Dashboard WS] Failed to parse message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[Dashboard WS] Disconnected');
        this.isConnected = false;
        this.emit('connection', { connected: false });
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[Dashboard WS] Error:', error);
        this.emit('error', { error: 'WebSocket error' });
      };
    } catch (error) {
      console.error('[Dashboard WS] Failed to connect:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: any): void {
    const { type, data } = message;

    switch (type) {
      case 'connected':
        this.emit('connected', data);
        break;

      case 'status':
        this.emit('feed_status', data);
        break;

      case 'transcript':
        this.emit('transcript', data);
        break;

      case 'autopilot':
        this.emit('autopilot', data);
        break;

      case 'active_tab_changed':
        this.emit('active_tab', data);
        break;

      case 'alert':
        this.emit('alert', data);
        break;

      case 'pong':
        // Heartbeat response
        break;

      default:
        console.log('[Dashboard WS] Unknown message type:', type);
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Dashboard WS] Max reconnect attempts reached');
      this.emit('error', { error: 'Max reconnect attempts reached' });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[Dashboard WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Send a message to the server
   */
  send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[Dashboard WS] Cannot send - not connected');
    }
  }

  /**
   * Send ping for heartbeat
   */
  ping(): void {
    this.send({ type: 'ping' });
  }

  /**
   * Subscribe to message type
   */
  on(event: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  /**
   * Emit event to handlers
   */
  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach(handler => handler(data));
  }

  /**
   * Check connection status
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
export const wsClient = new DashboardWebSocketClient();
