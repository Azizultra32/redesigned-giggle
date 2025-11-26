/**
 * PATH W: Supabase Offline Fallback
 *
 * Handles:
 * - Connection failure detection
 * - Local storage fallback
 * - Queue-based sync when online
 * - Data integrity during offline mode
 */

import { EventEmitter } from 'events';
import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

export interface OfflineConfig {
  storageDir: string;
  syncInterval: number;
  maxQueueSize: number;
  retryAttempts: number;
  healthCheckInterval: number;
}

const DEFAULT_CONFIG: OfflineConfig = {
  storageDir: '/tmp/assistmd-offline',
  syncInterval: 30000,       // 30 seconds
  maxQueueSize: 1000,
  retryAttempts: 3,
  healthCheckInterval: 10000 // 10 seconds
};

export type OfflineState = 'online' | 'offline' | 'syncing' | 'degraded';

export interface QueuedOperation {
  id: string;
  type: 'insert' | 'update' | 'upsert';
  table: string;
  data: Record<string, unknown>;
  timestamp: number;
  retries: number;
  error?: string;
}

export interface SyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export class OfflineManager extends EventEmitter {
  private supabase: SupabaseClient;
  private config: OfflineConfig;
  private state: OfflineState = 'online';
  private queue: QueuedOperation[] = [];
  private syncTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private lastOnlineAt: number | null = null;
  private lastOfflineAt: number | null = null;

  constructor(supabase: SupabaseClient, config: Partial<OfflineConfig> = {}) {
    super();
    this.supabase = supabase;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.ensureStorageDir();
    this.loadQueue();
    this.startHealthCheck();
  }

  // ─────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────

  public getState(): OfflineState {
    return this.state;
  }

  public isOnline(): boolean {
    return this.state === 'online' || this.state === 'syncing';
  }

  private setState(state: OfflineState): void {
    const prev = this.state;
    this.state = state;

    if (prev !== state) {
      if (state === 'online') {
        this.lastOnlineAt = Date.now();
      } else if (state === 'offline') {
        this.lastOfflineAt = Date.now();
      }

      this.emit('state:change', state, prev);
    }
  }

  // ─────────────────────────────────────────────
  // Health Check
  // ─────────────────────────────────────────────

  private startHealthCheck(): void {
    this.healthTimer = setInterval(async () => {
      await this.checkHealth();
    }, this.config.healthCheckInterval);

    // Initial check
    this.checkHealth();
  }

  private async checkHealth(): Promise<boolean> {
    try {
      // Simple query to check connection
      const { error } = await this.supabase
        .from('transcripts2')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (this.state === 'offline') {
        this.setState('online');
        this.emit('online');

        // Trigger sync when coming back online
        this.startSync();
      }

      return true;
    } catch (err) {
      if (this.state === 'online') {
        this.setState('offline');
        this.emit('offline', err);
      }
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Queue Operations
  // ─────────────────────────────────────────────

  public async insert(table: string, data: Record<string, unknown>): Promise<{ id?: number; queued: boolean }> {
    if (this.isOnline()) {
      try {
        const { data: result, error } = await this.supabase
          .from(table)
          .insert(data)
          .select('id')
          .single();

        if (error) throw error;

        return { id: result?.id, queued: false };
      } catch (err) {
        // Fall through to offline mode
        this.handleConnectionError(err);
      }
    }

    // Queue for later
    this.enqueue({
      type: 'insert',
      table,
      data
    });

    return { queued: true };
  }

  public async update(
    table: string,
    id: number,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; queued: boolean }> {
    if (this.isOnline()) {
      try {
        const { error } = await this.supabase
          .from(table)
          .update(data)
          .eq('id', id);

        if (error) throw error;

        return { success: true, queued: false };
      } catch (err) {
        this.handleConnectionError(err);
      }
    }

    this.enqueue({
      type: 'update',
      table,
      data: { ...data, _id: id }
    });

    return { success: false, queued: true };
  }

  public async upsert(
    table: string,
    data: Record<string, unknown>,
    onConflict?: string
  ): Promise<{ queued: boolean }> {
    if (this.isOnline()) {
      try {
        const { error } = await this.supabase
          .from(table)
          .upsert(data, { onConflict });

        if (error) throw error;

        return { queued: false };
      } catch (err) {
        this.handleConnectionError(err);
      }
    }

    this.enqueue({
      type: 'upsert',
      table,
      data: { ...data, _onConflict: onConflict }
    });

    return { queued: true };
  }

  private enqueue(op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries'>): void {
    if (this.queue.length >= this.config.maxQueueSize) {
      this.emit('queue:overflow');
      // Remove oldest non-critical item
      const idx = this.queue.findIndex(q => q.table !== 'transcripts2');
      if (idx >= 0) {
        this.queue.splice(idx, 1);
      } else {
        this.queue.shift();
      }
    }

    const operation: QueuedOperation = {
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...op,
      timestamp: Date.now(),
      retries: 0
    };

    this.queue.push(operation);
    this.persistQueue();

    this.emit('queued', operation);
  }

  // ─────────────────────────────────────────────
  // Sync
  // ─────────────────────────────────────────────

  public async startSync(): Promise<void> {
    if (this.state === 'syncing' || this.queue.length === 0) {
      return;
    }

    this.setState('syncing');
    this.emit('sync:start', { queueSize: this.queue.length });

    const result = await this.processQueue();

    this.emit('sync:complete', result);

    if (result.remaining > 0) {
      this.setState('degraded');
    } else {
      this.setState('online');
    }
  }

  private async processQueue(): Promise<SyncResult> {
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    const toProcess = [...this.queue];

    for (const op of toProcess) {
      processed++;

      try {
        await this.executeOperation(op);
        succeeded++;

        // Remove from queue
        const idx = this.queue.findIndex(q => q.id === op.id);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
        }
      } catch (err) {
        op.retries++;
        op.error = err instanceof Error ? err.message : 'Unknown error';

        if (op.retries >= this.config.retryAttempts) {
          failed++;
          // Move to dead letter queue (keep in queue but mark)
          this.emit('operation:failed', op);
        }
      }
    }

    this.persistQueue();

    return {
      processed,
      succeeded,
      failed,
      remaining: this.queue.length
    };
  }

  private async executeOperation(op: QueuedOperation): Promise<void> {
    switch (op.type) {
      case 'insert': {
        const { error } = await this.supabase
          .from(op.table)
          .insert(op.data);
        if (error) throw error;
        break;
      }

      case 'update': {
        const { _id, ...data } = op.data;
        const { error } = await this.supabase
          .from(op.table)
          .update(data)
          .eq('id', _id);
        if (error) throw error;
        break;
      }

      case 'upsert': {
        const { _onConflict, ...data } = op.data;
        const { error } = await this.supabase
          .from(op.table)
          .upsert(data, { onConflict: _onConflict as string | undefined });
        if (error) throw error;
        break;
      }
    }
  }

  // ─────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────

  private ensureStorageDir(): void {
    try {
      if (!fs.existsSync(this.config.storageDir)) {
        fs.mkdirSync(this.config.storageDir, { recursive: true });
      }
    } catch (err) {
      this.emit('storage:error', err);
    }
  }

  private getQueuePath(): string {
    return path.join(this.config.storageDir, 'queue.json');
  }

  private persistQueue(): void {
    try {
      fs.writeFileSync(
        this.getQueuePath(),
        JSON.stringify(this.queue, null, 2)
      );
    } catch (err) {
      this.emit('storage:error', err);
    }
  }

  private loadQueue(): void {
    try {
      const queuePath = this.getQueuePath();
      if (fs.existsSync(queuePath)) {
        const data = fs.readFileSync(queuePath, 'utf-8');
        this.queue = JSON.parse(data);
        this.emit('queue:loaded', this.queue.length);
      }
    } catch (err) {
      this.emit('storage:error', err);
      this.queue = [];
    }
  }

  // ─────────────────────────────────────────────
  // Error Handling
  // ─────────────────────────────────────────────

  private handleConnectionError(err: unknown): void {
    const message = err instanceof Error ? err.message : 'Unknown error';

    // Check if it's a connection error
    if (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('ECONNREFUSED') ||
      message.includes('timeout')
    ) {
      this.setState('offline');
      this.emit('offline', err);
    }
  }

  // ─────────────────────────────────────────────
  // Stats & Queries
  // ─────────────────────────────────────────────

  public getQueueSize(): number {
    return this.queue.length;
  }

  public getQueueStats(): QueueStats {
    const byTable: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let failedCount = 0;

    for (const op of this.queue) {
      byTable[op.table] = (byTable[op.table] || 0) + 1;
      byType[op.type] = (byType[op.type] || 0) + 1;
      if (op.retries >= this.config.retryAttempts) {
        failedCount++;
      }
    }

    return {
      total: this.queue.length,
      byTable,
      byType,
      failed: failedCount,
      oldestTimestamp: this.queue[0]?.timestamp || null
    };
  }

  public getStats(): OfflineStats {
    return {
      state: this.state,
      queueSize: this.queue.length,
      lastOnlineAt: this.lastOnlineAt,
      lastOfflineAt: this.lastOfflineAt,
      queue: this.getQueueStats()
    };
  }

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────

  public clearQueue(): void {
    this.queue = [];
    this.persistQueue();
    this.emit('queue:cleared');
  }

  public destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.persistQueue();
  }
}

export interface QueueStats {
  total: number;
  byTable: Record<string, number>;
  byType: Record<string, number>;
  failed: number;
  oldestTimestamp: number | null;
}

export interface OfflineStats {
  state: OfflineState;
  queueSize: number;
  lastOnlineAt: number | null;
  lastOfflineAt: number | null;
  queue: QueueStats;
}

export default OfflineManager;
