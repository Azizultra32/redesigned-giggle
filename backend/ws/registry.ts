/**
 * PATH U: Broadcast Fan-Out Logic (WsBridge Registry)
 *
 * Manages:
 * - Client registration by type (overlay, dashboard, agent)
 * - Topic-based subscriptions
 * - Efficient fan-out broadcast
 * - Feed-specific routing
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export type ClientType = 'overlay' | 'dashboard' | 'agent' | 'mcp';

export type FeedId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface RegisteredClient {
  id: string;
  ws: WebSocket;
  type: ClientType;
  doctorId: string | null;
  subscribedFeeds: Set<FeedId>;
  subscribedTopics: Set<string>;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number;
  metadata: ClientMetadata;
}

export interface ClientMetadata {
  userAgent?: string;
  version?: string;
  windowId?: string;
  tabId?: number;
}

export interface BroadcastOptions {
  feed?: FeedId;
  topic?: string;
  clientTypes?: ClientType[];
  doctorId?: string;
  excludeClientIds?: string[];
}

export class ClientRegistry extends EventEmitter {
  private clients: Map<string, RegisteredClient> = new Map();
  private byType: Map<ClientType, Set<string>> = new Map();
  private byDoctor: Map<string, Set<string>> = new Map();
  private byFeed: Map<FeedId, Set<string>> = new Map();
  private byTopic: Map<string, Set<string>> = new Map();

  constructor() {
    super();
    this.initializeIndexes();
  }

  private initializeIndexes(): void {
    // Initialize type indexes
    const types: ClientType[] = ['overlay', 'dashboard', 'agent', 'mcp'];
    for (const type of types) {
      this.byType.set(type, new Set());
    }

    // Initialize feed indexes
    const feeds: FeedId[] = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const feed of feeds) {
      this.byFeed.set(feed, new Set());
    }
  }

  // ─────────────────────────────────────────────
  // Client Registration
  // ─────────────────────────────────────────────

  public register(params: {
    ws: WebSocket;
    type: ClientType;
    doctorId?: string;
    metadata?: ClientMetadata;
  }): RegisteredClient {
    const id = this.generateClientId();

    const client: RegisteredClient = {
      id,
      ws: params.ws,
      type: params.type,
      doctorId: params.doctorId || null,
      subscribedFeeds: new Set(),
      subscribedTopics: new Set(),
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: 0,
      metadata: params.metadata || {}
    };

    this.clients.set(id, client);
    this.indexClient(client);

    // Auto-subscribe overlays to all feeds
    if (params.type === 'overlay') {
      this.subscribeToAllFeeds(id);
    }

    this.emit('client:registered', client);
    return client;
  }

  public unregister(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    this.unindexClient(client);
    this.clients.delete(clientId);

    this.emit('client:unregistered', client);
  }

  public get(clientId: string): RegisteredClient | undefined {
    return this.clients.get(clientId);
  }

  // ─────────────────────────────────────────────
  // Subscriptions
  // ─────────────────────────────────────────────

  public subscribeToFeed(clientId: string, feed: FeedId): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscribedFeeds.add(feed);
    this.byFeed.get(feed)?.add(clientId);

    this.emit('subscription:feed', clientId, feed);
  }

  public unsubscribeFromFeed(clientId: string, feed: FeedId): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscribedFeeds.delete(feed);
    this.byFeed.get(feed)?.delete(clientId);
  }

  public subscribeToAllFeeds(clientId: string): void {
    const feeds: FeedId[] = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const feed of feeds) {
      this.subscribeToFeed(clientId, feed);
    }
  }

  public subscribeToTopic(clientId: string, topic: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscribedTopics.add(topic);

    let topicSet = this.byTopic.get(topic);
    if (!topicSet) {
      topicSet = new Set();
      this.byTopic.set(topic, topicSet);
    }
    topicSet.add(clientId);

    this.emit('subscription:topic', clientId, topic);
  }

  public unsubscribeFromTopic(clientId: string, topic: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscribedTopics.delete(topic);
    this.byTopic.get(topic)?.delete(clientId);
  }

  // ─────────────────────────────────────────────
  // Broadcasting
  // ─────────────────────────────────────────────

  public broadcast(message: object, options: BroadcastOptions = {}): BroadcastResult {
    const targetClients = this.resolveTargets(options);
    const payload = JSON.stringify(message);

    let sent = 0;
    let failed = 0;
    const errors: Array<{ clientId: string; error: string }> = [];

    for (const clientId of targetClients) {
      const client = this.clients.get(clientId);
      if (!client) continue;

      if (options.excludeClientIds?.includes(clientId)) continue;

      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
          client.lastMessageAt = Date.now();
          client.messageCount++;
          sent++;
        } catch (err) {
          failed++;
          errors.push({
            clientId,
            error: err instanceof Error ? err.message : 'Unknown error'
          });
        }
      } else {
        failed++;
      }
    }

    const result: BroadcastResult = {
      targetCount: targetClients.size,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined
    };

    this.emit('broadcast:complete', result);
    return result;
  }

  private resolveTargets(options: BroadcastOptions): Set<string> {
    const targets = new Set<string>();

    // Start with all clients if no filters
    if (!options.feed && !options.topic && !options.clientTypes && !options.doctorId) {
      for (const id of this.clients.keys()) {
        targets.add(id);
      }
      return targets;
    }

    // Filter by feed
    if (options.feed) {
      const feedClients = this.byFeed.get(options.feed);
      if (feedClients) {
        for (const id of feedClients) {
          targets.add(id);
        }
      }
    }

    // Filter by topic
    if (options.topic) {
      const topicClients = this.byTopic.get(options.topic);
      if (topicClients) {
        if (targets.size === 0) {
          for (const id of topicClients) {
            targets.add(id);
          }
        } else {
          // Intersect
          for (const id of targets) {
            if (!topicClients.has(id)) {
              targets.delete(id);
            }
          }
        }
      }
    }

    // Filter by client type
    if (options.clientTypes && options.clientTypes.length > 0) {
      const typeClients = new Set<string>();
      for (const type of options.clientTypes) {
        const clients = this.byType.get(type);
        if (clients) {
          for (const id of clients) {
            typeClients.add(id);
          }
        }
      }

      if (targets.size === 0) {
        for (const id of typeClients) {
          targets.add(id);
        }
      } else {
        for (const id of targets) {
          if (!typeClients.has(id)) {
            targets.delete(id);
          }
        }
      }
    }

    // Filter by doctor
    if (options.doctorId) {
      const doctorClients = this.byDoctor.get(options.doctorId);
      if (doctorClients) {
        if (targets.size === 0) {
          for (const id of doctorClients) {
            targets.add(id);
          }
        } else {
          for (const id of targets) {
            if (!doctorClients.has(id)) {
              targets.delete(id);
            }
          }
        }
      } else {
        targets.clear();
      }
    }

    return targets;
  }

  // ─────────────────────────────────────────────
  // Feed-Specific Broadcasts
  // ─────────────────────────────────────────────

  public broadcastTranscript(data: {
    text: string;
    speaker: number;
    isFinal: boolean;
    confidence?: number;
  }, doctorId?: string): BroadcastResult {
    return this.broadcast(
      { kind: 'transcript', feed: 'A', ...data },
      { feed: 'A', doctorId }
    );
  }

  public broadcastVoiceCommand(data: {
    command: string;
    params?: Record<string, unknown>;
  }, doctorId?: string): BroadcastResult {
    return this.broadcast(
      { kind: 'voice_command', feed: 'B', ...data },
      { feed: 'B', doctorId }
    );
  }

  public broadcastEmergency(data: {
    severity: 'warning' | 'critical';
    message: string;
    phrase?: string;
  }, doctorId?: string): BroadcastResult {
    return this.broadcast(
      { kind: 'emergency', feed: 'C', ...data },
      { feed: 'C', doctorId }
    );
  }

  public broadcastAutopilot(data: {
    status: 'ready' | 'learning' | 'offline';
    surfaces?: number;
  }, doctorId?: string): BroadcastResult {
    return this.broadcast(
      { kind: 'autopilot', feed: 'D', ...data },
      { feed: 'D', doctorId }
    );
  }

  public broadcastConsent(data: {
    timestamp: number;
    phrase: string;
  }, doctorId?: string): BroadcastResult {
    return this.broadcast(
      { kind: 'consent_logged', feed: 'E', ...data },
      { feed: 'E', doctorId }
    );
  }

  public broadcastAudioResponse(data: {
    audioUrl?: string;
    text: string;
  }, doctorId?: string): BroadcastResult {
    return this.broadcast(
      { kind: 'audio_response', feed: 'F', ...data },
      { feed: 'F', doctorId }
    );
  }

  // ─────────────────────────────────────────────
  // Indexing
  // ─────────────────────────────────────────────

  private indexClient(client: RegisteredClient): void {
    this.byType.get(client.type)?.add(client.id);

    if (client.doctorId) {
      let doctorSet = this.byDoctor.get(client.doctorId);
      if (!doctorSet) {
        doctorSet = new Set();
        this.byDoctor.set(client.doctorId, doctorSet);
      }
      doctorSet.add(client.id);
    }
  }

  private unindexClient(client: RegisteredClient): void {
    this.byType.get(client.type)?.delete(client.id);

    if (client.doctorId) {
      const doctorSet = this.byDoctor.get(client.doctorId);
      if (doctorSet) {
        doctorSet.delete(client.id);
        if (doctorSet.size === 0) {
          this.byDoctor.delete(client.doctorId);
        }
      }
    }

    for (const feed of client.subscribedFeeds) {
      this.byFeed.get(feed)?.delete(client.id);
    }

    for (const topic of client.subscribedTopics) {
      this.byTopic.get(topic)?.delete(client.id);
    }
  }

  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ─────────────────────────────────────────────
  // Stats & Queries
  // ─────────────────────────────────────────────

  public getClientsByType(type: ClientType): RegisteredClient[] {
    const ids = this.byType.get(type);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this.clients.get(id))
      .filter((c): c is RegisteredClient => c !== undefined);
  }

  public getClientsByDoctor(doctorId: string): RegisteredClient[] {
    const ids = this.byDoctor.get(doctorId);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this.clients.get(id))
      .filter((c): c is RegisteredClient => c !== undefined);
  }

  public getStats(): RegistryStats {
    const byType: Record<ClientType, number> = {
      overlay: 0,
      dashboard: 0,
      agent: 0,
      mcp: 0
    };

    const byFeed: Record<FeedId, number> = {
      A: 0, B: 0, C: 0, D: 0, E: 0, F: 0
    };

    for (const [type, ids] of this.byType) {
      byType[type] = ids.size;
    }

    for (const [feed, ids] of this.byFeed) {
      byFeed[feed] = ids.size;
    }

    return {
      totalClients: this.clients.size,
      byType,
      byFeed,
      totalDoctors: this.byDoctor.size,
      totalTopics: this.byTopic.size
    };
  }
}

export interface BroadcastResult {
  targetCount: number;
  sent: number;
  failed: number;
  errors?: Array<{ clientId: string; error: string }>;
}

export interface RegistryStats {
  totalClients: number;
  byType: Record<ClientType, number>;
  byFeed: Record<FeedId, number>;
  totalDoctors: number;
  totalTopics: number;
}

export default ClientRegistry;
