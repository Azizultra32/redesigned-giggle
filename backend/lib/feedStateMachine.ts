/**
 * PATH X: Agent State Machine (Feeds A-E)
 *
 * Manages the state of all system feeds:
 * - Feed A: Deepgram Transcription
 * - Feed B: Voice Concierge (Commands)
 * - Feed C: Emergency Monitor
 * - Feed D: Autopilot / Patient Summary
 * - Feed E: Consent / Compliance Audit
 * - Feed F: Audio Response (TTS)
 */

import { EventEmitter } from 'events';

export type FeedId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type FeedStatus =
  | 'offline'
  | 'initializing'
  | 'ready'
  | 'active'
  | 'error'
  | 'degraded';

export interface FeedState {
  id: FeedId;
  name: string;
  status: FeedStatus;
  lastUpdate: number;
  lastError: string | null;
  metadata: Record<string, unknown>;
}

export interface FeedTransition {
  from: FeedStatus;
  to: FeedStatus;
  timestamp: number;
  reason?: string;
}

export interface AgentState {
  feeds: Record<FeedId, FeedState>;
  overallStatus: 'healthy' | 'degraded' | 'critical' | 'offline';
  activeFeeds: number;
  lastHeartbeat: number;
}

const FEED_CONFIG: Record<FeedId, { name: string; critical: boolean }> = {
  A: { name: 'Deepgram Transcription', critical: true },
  B: { name: 'Voice Concierge', critical: false },
  C: { name: 'Emergency Monitor', critical: true },
  D: { name: 'Autopilot', critical: false },
  E: { name: 'Consent Audit', critical: false },
  F: { name: 'Audio Response', critical: false }
};

export class FeedStateMachine extends EventEmitter {
  private feeds: Map<FeedId, FeedState> = new Map();
  private transitions: FeedTransition[] = [];
  private maxTransitionHistory = 100;

  constructor() {
    super();
    this.initializeFeeds();
  }

  private initializeFeeds(): void {
    const feedIds: FeedId[] = ['A', 'B', 'C', 'D', 'E', 'F'];

    for (const id of feedIds) {
      const config = FEED_CONFIG[id];
      this.feeds.set(id, {
        id,
        name: config.name,
        status: 'offline',
        lastUpdate: Date.now(),
        lastError: null,
        metadata: {}
      });
    }
  }

  // ─────────────────────────────────────────────
  // State Transitions
  // ─────────────────────────────────────────────

  public setFeedStatus(
    feedId: FeedId,
    status: FeedStatus,
    reason?: string,
    metadata?: Record<string, unknown>
  ): void {
    const feed = this.feeds.get(feedId);
    if (!feed) return;

    const prevStatus = feed.status;

    if (!this.isValidTransition(prevStatus, status)) {
      this.emit('invalid_transition', { feedId, from: prevStatus, to: status });
      return;
    }

    // Record transition
    const transition: FeedTransition = {
      from: prevStatus,
      to: status,
      timestamp: Date.now(),
      reason
    };

    this.transitions.push(transition);
    if (this.transitions.length > this.maxTransitionHistory) {
      this.transitions.shift();
    }

    // Update feed state
    feed.status = status;
    feed.lastUpdate = Date.now();

    if (status === 'error' && reason) {
      feed.lastError = reason;
    }

    if (metadata) {
      feed.metadata = { ...feed.metadata, ...metadata };
    }

    this.emit('feed:status', feedId, status, prevStatus);
    this.emit(`feed:${feedId}:${status}`);

    // Check overall health
    this.evaluateOverallStatus();
  }

  private isValidTransition(from: FeedStatus, to: FeedStatus): boolean {
    const validTransitions: Record<FeedStatus, FeedStatus[]> = {
      'offline': ['initializing', 'error'],
      'initializing': ['ready', 'error', 'offline'],
      'ready': ['active', 'error', 'offline', 'degraded'],
      'active': ['ready', 'error', 'offline', 'degraded'],
      'error': ['offline', 'initializing', 'ready'],
      'degraded': ['ready', 'active', 'error', 'offline']
    };

    return validTransitions[from]?.includes(to) ?? false;
  }

  // ─────────────────────────────────────────────
  // Feed-Specific Methods
  // ─────────────────────────────────────────────

  // Feed A: Transcription
  public setTranscriptionActive(active: boolean): void {
    this.setFeedStatus('A', active ? 'active' : 'ready');
  }

  public setTranscriptionError(error: string): void {
    this.setFeedStatus('A', 'error', error);
  }

  // Feed B: Voice Concierge
  public setVoiceConciergeReady(): void {
    this.setFeedStatus('B', 'ready');
  }

  public triggerVoiceCommand(command: string): void {
    const feed = this.feeds.get('B');
    if (feed) {
      feed.metadata.lastCommand = command;
      feed.metadata.commandCount = ((feed.metadata.commandCount as number) || 0) + 1;
      this.setFeedStatus('B', 'active', `Command: ${command}`);

      // Return to ready after command processed
      setTimeout(() => {
        this.setFeedStatus('B', 'ready');
      }, 1000);
    }
  }

  // Feed C: Emergency Monitor
  public setEmergencyMonitorActive(): void {
    this.setFeedStatus('C', 'active');
  }

  public triggerEmergency(severity: 'warning' | 'critical', phrase: string): void {
    this.setFeedStatus('C', 'active', `${severity}: ${phrase}`, {
      lastEmergency: {
        severity,
        phrase,
        timestamp: Date.now()
      }
    });

    this.emit('emergency:triggered', { severity, phrase });
  }

  public clearEmergency(): void {
    this.setFeedStatus('C', 'ready');
  }

  // Feed D: Autopilot
  public setAutopilotLearning(surfaces: number): void {
    this.setFeedStatus('D', 'initializing', 'Learning DOM', { surfaces });
  }

  public setAutopilotReady(surfaces: number): void {
    this.setFeedStatus('D', 'ready', undefined, {
      surfaces,
      readyAt: Date.now()
    });
  }

  public setAutopilotActive(action: string): void {
    this.setFeedStatus('D', 'active', action);
  }

  // Feed E: Consent Audit
  public logConsent(phrase: string): void {
    const feed = this.feeds.get('E');
    if (feed) {
      const consentLog = (feed.metadata.consentLog as Array<{ phrase: string; timestamp: number }>) || [];
      consentLog.push({ phrase, timestamp: Date.now() });
      feed.metadata.consentLog = consentLog;
      feed.metadata.lastConsent = Date.now();

      this.setFeedStatus('E', 'active', `Consent: ${phrase}`);

      this.emit('consent:logged', { phrase, timestamp: Date.now() });

      setTimeout(() => {
        this.setFeedStatus('E', 'ready');
      }, 2000);
    }
  }

  public getConsentLog(): Array<{ phrase: string; timestamp: number }> {
    const feed = this.feeds.get('E');
    return (feed?.metadata.consentLog as Array<{ phrase: string; timestamp: number }>) || [];
  }

  // Feed F: Audio Response
  public setAudioResponsePlaying(text: string): void {
    this.setFeedStatus('F', 'active', text, {
      currentText: text,
      playingAt: Date.now()
    });
  }

  public setAudioResponseComplete(): void {
    this.setFeedStatus('F', 'ready');
  }

  // ─────────────────────────────────────────────
  // Overall Status
  // ─────────────────────────────────────────────

  private evaluateOverallStatus(): void {
    const states = this.getAgentState();
    const prevOverall = states.overallStatus;

    let critical = 0;
    let errored = 0;
    let offline = 0;

    for (const [feedId, feed] of this.feeds) {
      const config = FEED_CONFIG[feedId];

      if (feed.status === 'error') {
        errored++;
        if (config.critical) critical++;
      } else if (feed.status === 'offline') {
        offline++;
        if (config.critical) critical++;
      }
    }

    let newOverall: AgentState['overallStatus'];

    if (critical > 0) {
      newOverall = 'critical';
    } else if (errored > 0 || offline > 1) {
      newOverall = 'degraded';
    } else if (offline === this.feeds.size) {
      newOverall = 'offline';
    } else {
      newOverall = 'healthy';
    }

    if (newOverall !== prevOverall) {
      this.emit('overall:status', newOverall, prevOverall);
    }
  }

  // ─────────────────────────────────────────────
  // Queries
  // ─────────────────────────────────────────────

  public getFeedState(feedId: FeedId): FeedState | undefined {
    return this.feeds.get(feedId);
  }

  public getAllFeedStates(): Record<FeedId, FeedState> {
    const result: Record<FeedId, FeedState> = {} as Record<FeedId, FeedState>;
    for (const [id, state] of this.feeds) {
      result[id] = { ...state };
    }
    return result;
  }

  public getAgentState(): AgentState {
    const feeds = this.getAllFeedStates();
    let activeCount = 0;
    let criticalErrors = 0;
    let totalErrors = 0;
    let offlineCount = 0;

    for (const [feedId, feed] of Object.entries(feeds) as [FeedId, FeedState][]) {
      if (feed.status === 'active') activeCount++;
      if (feed.status === 'error') {
        totalErrors++;
        if (FEED_CONFIG[feedId].critical) criticalErrors++;
      }
      if (feed.status === 'offline') offlineCount++;
    }

    let overallStatus: AgentState['overallStatus'];
    if (criticalErrors > 0) {
      overallStatus = 'critical';
    } else if (totalErrors > 0) {
      overallStatus = 'degraded';
    } else if (offlineCount === this.feeds.size) {
      overallStatus = 'offline';
    } else {
      overallStatus = 'healthy';
    }

    return {
      feeds,
      overallStatus,
      activeFeeds: activeCount,
      lastHeartbeat: Date.now()
    };
  }

  public getRecentTransitions(limit = 10): FeedTransition[] {
    return this.transitions.slice(-limit);
  }

  // ─────────────────────────────────────────────
  // Bulk Operations
  // ─────────────────────────────────────────────

  public initializeAll(): void {
    const feedIds: FeedId[] = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const id of feedIds) {
      this.setFeedStatus(id, 'initializing');
    }
  }

  public readyAll(): void {
    const feedIds: FeedId[] = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const id of feedIds) {
      const feed = this.feeds.get(id);
      if (feed && feed.status === 'initializing') {
        this.setFeedStatus(id, 'ready');
      }
    }
  }

  public offlineAll(): void {
    const feedIds: FeedId[] = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const id of feedIds) {
      this.setFeedStatus(id, 'offline');
    }
  }

  // ─────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────

  public toJSON(): object {
    return {
      feeds: this.getAllFeedStates(),
      transitions: this.getRecentTransitions(20),
      agent: this.getAgentState()
    };
  }

  public hydrate(snapshot: {
    feeds: Record<FeedId, FeedState>;
    transitions?: FeedTransition[];
  }): void {
    for (const [id, state] of Object.entries(snapshot.feeds) as [FeedId, FeedState][]) {
      const feed = this.feeds.get(id);
      if (feed) {
        Object.assign(feed, state);
      }
    }

    if (snapshot.transitions) {
      this.transitions = snapshot.transitions;
    }
  }
}

export default FeedStateMachine;
