/**
 * PATH R: Session Handling & Temporary Memory
 *
 * Manages:
 * - Session creation and lifecycle
 * - Temporary in-memory storage before Supabase persist
 * - Session recovery on reconnect
 * - TTL-based cleanup
 */

import { EventEmitter } from 'events';
import { LifecycleOrchestrator, LifecycleState } from './lifecycle';

export interface Session {
  id: string;
  doctorId: string;
  patientCode: string | null;
  windowId: string;
  tabId: number;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  state: SessionState;
  orchestrator: LifecycleOrchestrator;
  pendingChunks: PendingChunk[];
  metadata: SessionMetadata;
}

export type SessionState = 'active' | 'paused' | 'expired' | 'closed';

export interface PendingChunk {
  id: string;
  text: string;
  speaker: number;
  timestamp: number;
  persisted: boolean;
}

export interface SessionMetadata {
  userAgent: string;
  url: string;
  ehrSystem: string | null;
  domFields: string[];
}

export interface SessionManagerConfig {
  sessionTTL: number;        // Default: 30 minutes
  cleanupInterval: number;   // Default: 5 minutes
  maxPendingChunks: number;  // Default: 100
  persistBatchSize: number;  // Default: 10
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  sessionTTL: 30 * 60 * 1000,       // 30 minutes
  cleanupInterval: 5 * 60 * 1000,   // 5 minutes
  maxPendingChunks: 100,
  persistBatchSize: 10
};

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private doctorSessions: Map<string, Set<string>> = new Map();
  private windowSessions: Map<string, string> = new Map();
  private config: SessionManagerConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<SessionManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  // ─────────────────────────────────────────────
  // Session Lifecycle
  // ─────────────────────────────────────────────

  public createSession(params: {
    doctorId: string;
    windowId: string;
    tabId: number;
    metadata: Partial<SessionMetadata>;
  }): Session {
    const id = this.generateSessionId();
    const now = Date.now();

    const session: Session = {
      id,
      doctorId: params.doctorId,
      patientCode: null,
      windowId: params.windowId,
      tabId: params.tabId,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + this.config.sessionTTL,
      state: 'active',
      orchestrator: new LifecycleOrchestrator(id),
      pendingChunks: [],
      metadata: {
        userAgent: params.metadata.userAgent || '',
        url: params.metadata.url || '',
        ehrSystem: params.metadata.ehrSystem || null,
        domFields: params.metadata.domFields || []
      }
    };

    this.sessions.set(id, session);
    this.indexSession(session);

    this.emit('session:created', session);
    return session;
  }

  public getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  public getSessionByWindow(windowId: string): Session | undefined {
    const sessionId = this.windowSessions.get(windowId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  public getDoctorSessions(doctorId: string): Session[] {
    const sessionIds = this.doctorSessions.get(doctorId);
    if (!sessionIds) return [];

    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined);
  }

  public touchSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.lastActivityAt = Date.now();
    session.expiresAt = session.lastActivityAt + this.config.sessionTTL;

    if (session.state === 'paused') {
      session.state = 'active';
      this.emit('session:resumed', session);
    }
  }

  public pauseSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.state !== 'active') return;

    session.state = 'paused';
    this.emit('session:paused', session);
  }

  public closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.state = 'closed';
    this.unindexSession(session);
    this.sessions.delete(id);

    this.emit('session:closed', session);
  }

  // ─────────────────────────────────────────────
  // Pending Chunks (Temporary Memory)
  // ─────────────────────────────────────────────

  public addPendingChunk(sessionId: string, chunk: Omit<PendingChunk, 'id' | 'persisted'>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pendingChunk: PendingChunk = {
      id: `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...chunk,
      persisted: false
    };

    session.pendingChunks.push(pendingChunk);

    // Trim if exceeds max
    if (session.pendingChunks.length > this.config.maxPendingChunks) {
      const removed = session.pendingChunks.shift();
      if (removed && !removed.persisted) {
        this.emit('chunk:dropped', sessionId, removed);
      }
    }

    this.touchSession(sessionId);
    this.emit('chunk:added', sessionId, pendingChunk);
  }

  public getPendingChunks(sessionId: string, unpersisted = false): PendingChunk[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    if (unpersisted) {
      return session.pendingChunks.filter(c => !c.persisted);
    }
    return [...session.pendingChunks];
  }

  public markChunksPersisted(sessionId: string, chunkIds: string[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const idSet = new Set(chunkIds);
    for (const chunk of session.pendingChunks) {
      if (idSet.has(chunk.id)) {
        chunk.persisted = true;
      }
    }

    this.emit('chunks:persisted', sessionId, chunkIds);
  }

  public getNextPersistBatch(sessionId: string): PendingChunk[] {
    const unpersisted = this.getPendingChunks(sessionId, true);
    return unpersisted.slice(0, this.config.persistBatchSize);
  }

  // ─────────────────────────────────────────────
  // Session Recovery
  // ─────────────────────────────────────────────

  public recoverSession(windowId: string, doctorId: string): Session | null {
    // Try to find existing session for this window
    let session = this.getSessionByWindow(windowId);

    if (session && session.state !== 'closed' && session.state !== 'expired') {
      this.touchSession(session.id);
      this.emit('session:recovered', session);
      return session;
    }

    // Check for other active sessions by this doctor
    const doctorSessions = this.getDoctorSessions(doctorId);
    const recentActive = doctorSessions.find(s =>
      s.state === 'active' || s.state === 'paused'
    );

    if (recentActive) {
      // Link this window to existing session
      this.windowSessions.set(windowId, recentActive.id);
      this.touchSession(recentActive.id);
      this.emit('session:linked', recentActive, windowId);
      return recentActive;
    }

    return null;
  }

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.config.cleanupInterval);
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expired: Session[] = [];

    for (const session of this.sessions.values()) {
      if (session.expiresAt < now && session.state !== 'closed') {
        session.state = 'expired';
        expired.push(session);
      }
    }

    for (const session of expired) {
      this.emit('session:expired', session);

      // Keep for a bit longer in case of recovery
      setTimeout(() => {
        if (session.state === 'expired') {
          this.closeSession(session.id);
        }
      }, 60000); // 1 minute grace period
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const session of this.sessions.values()) {
      this.closeSession(session.id);
    }
  }

  // ─────────────────────────────────────────────
  // Indexing
  // ─────────────────────────────────────────────

  private indexSession(session: Session): void {
    // Index by doctor
    let doctorSet = this.doctorSessions.get(session.doctorId);
    if (!doctorSet) {
      doctorSet = new Set();
      this.doctorSessions.set(session.doctorId, doctorSet);
    }
    doctorSet.add(session.id);

    // Index by window
    this.windowSessions.set(session.windowId, session.id);
  }

  private unindexSession(session: Session): void {
    const doctorSet = this.doctorSessions.get(session.doctorId);
    if (doctorSet) {
      doctorSet.delete(session.id);
      if (doctorSet.size === 0) {
        this.doctorSessions.delete(session.doctorId);
      }
    }

    this.windowSessions.delete(session.windowId);
  }

  private generateSessionId(): string {
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  // ─────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────

  public getStats(): SessionStats {
    let active = 0, paused = 0, expired = 0;
    let totalPending = 0, unpersistedPending = 0;

    for (const session of this.sessions.values()) {
      if (session.state === 'active') active++;
      else if (session.state === 'paused') paused++;
      else if (session.state === 'expired') expired++;

      totalPending += session.pendingChunks.length;
      unpersistedPending += session.pendingChunks.filter(c => !c.persisted).length;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: active,
      pausedSessions: paused,
      expiredSessions: expired,
      totalDoctors: this.doctorSessions.size,
      totalPendingChunks: totalPending,
      unpersistedChunks: unpersistedPending
    };
  }
}

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  pausedSessions: number;
  expiredSessions: number;
  totalDoctors: number;
  totalPendingChunks: number;
  unpersistedChunks: number;
}

export default SessionManager;
