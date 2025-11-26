/**
 * PATH S: Multi-Window Interaction
 *
 * Manages:
 * - Multiple browser windows/tabs per doctor
 * - Cross-window state synchronization
 * - Leader election for recording
 * - Broadcast coordination
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

export interface WindowInfo {
  id: string;
  tabId: number;
  ws: WebSocket;
  doctorId: string;
  sessionId: string | null;
  url: string;
  isLeader: boolean;
  isRecording: boolean;
  connectedAt: number;
  lastPingAt: number;
}

export interface WindowGroup {
  doctorId: string;
  leaderId: string | null;
  windows: Map<string, WindowInfo>;
  recordingWindowId: string | null;
}

export class MultiWindowManager extends EventEmitter {
  private windows: Map<string, WindowInfo> = new Map();
  private groups: Map<string, WindowGroup> = new Map();

  constructor() {
    super();
  }

  // ─────────────────────────────────────────────
  // Window Registration
  // ─────────────────────────────────────────────

  public registerWindow(params: {
    windowId: string;
    tabId: number;
    ws: WebSocket;
    doctorId: string;
    url: string;
  }): WindowInfo {
    const { windowId, tabId, ws, doctorId, url } = params;

    const window: WindowInfo = {
      id: windowId,
      tabId,
      ws,
      doctorId,
      sessionId: null,
      url,
      isLeader: false,
      isRecording: false,
      connectedAt: Date.now(),
      lastPingAt: Date.now()
    };

    this.windows.set(windowId, window);
    this.addToGroup(window);
    this.electLeader(doctorId);

    this.emit('window:registered', window);
    return window;
  }

  public unregisterWindow(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) return;

    this.removeFromGroup(window);
    this.windows.delete(windowId);

    // Re-elect leader if needed
    if (window.isLeader) {
      this.electLeader(window.doctorId);
    }

    this.emit('window:unregistered', window);
  }

  public getWindow(windowId: string): WindowInfo | undefined {
    return this.windows.get(windowId);
  }

  public getWindowsByDoctor(doctorId: string): WindowInfo[] {
    const group = this.groups.get(doctorId);
    if (!group) return [];
    return Array.from(group.windows.values());
  }

  // ─────────────────────────────────────────────
  // Group Management
  // ─────────────────────────────────────────────

  private addToGroup(window: WindowInfo): void {
    let group = this.groups.get(window.doctorId);

    if (!group) {
      group = {
        doctorId: window.doctorId,
        leaderId: null,
        windows: new Map(),
        recordingWindowId: null
      };
      this.groups.set(window.doctorId, group);
    }

    group.windows.set(window.id, window);
  }

  private removeFromGroup(window: WindowInfo): void {
    const group = this.groups.get(window.doctorId);
    if (!group) return;

    group.windows.delete(window.id);

    if (group.recordingWindowId === window.id) {
      group.recordingWindowId = null;
      this.emit('recording:orphaned', window.doctorId);
    }

    if (group.windows.size === 0) {
      this.groups.delete(window.doctorId);
    }
  }

  // ─────────────────────────────────────────────
  // Leader Election
  // ─────────────────────────────────────────────

  private electLeader(doctorId: string): void {
    const group = this.groups.get(doctorId);
    if (!group || group.windows.size === 0) return;

    // Clear current leader
    if (group.leaderId) {
      const oldLeader = group.windows.get(group.leaderId);
      if (oldLeader) {
        oldLeader.isLeader = false;
      }
    }

    // Elect new leader (oldest connected window)
    let leader: WindowInfo | null = null;
    let oldestTime = Infinity;

    for (const window of group.windows.values()) {
      if (window.connectedAt < oldestTime) {
        oldestTime = window.connectedAt;
        leader = window;
      }
    }

    if (leader) {
      leader.isLeader = true;
      group.leaderId = leader.id;
      this.emit('leader:elected', leader);
      this.broadcastToGroup(doctorId, {
        kind: 'leader_changed',
        leaderId: leader.id
      });
    }
  }

  public getLeader(doctorId: string): WindowInfo | null {
    const group = this.groups.get(doctorId);
    if (!group || !group.leaderId) return null;
    return group.windows.get(group.leaderId) || null;
  }

  // ─────────────────────────────────────────────
  // Recording Coordination
  // ─────────────────────────────────────────────

  public startRecording(windowId: string): boolean {
    const window = this.windows.get(windowId);
    if (!window) return false;

    const group = this.groups.get(window.doctorId);
    if (!group) return false;

    // Only one window can record at a time
    if (group.recordingWindowId && group.recordingWindowId !== windowId) {
      const currentRecorder = group.windows.get(group.recordingWindowId);
      if (currentRecorder && currentRecorder.isRecording) {
        this.emit('recording:conflict', {
          requested: windowId,
          current: group.recordingWindowId
        });
        return false;
      }
    }

    window.isRecording = true;
    group.recordingWindowId = windowId;

    this.broadcastToGroup(window.doctorId, {
      kind: 'recording_started',
      windowId,
      startedAt: Date.now()
    }, windowId);

    this.emit('recording:started', window);
    return true;
  }

  public stopRecording(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) return;

    const group = this.groups.get(window.doctorId);
    if (!group) return;

    window.isRecording = false;
    if (group.recordingWindowId === windowId) {
      group.recordingWindowId = null;
    }

    this.broadcastToGroup(window.doctorId, {
      kind: 'recording_stopped',
      windowId,
      stoppedAt: Date.now()
    }, windowId);

    this.emit('recording:stopped', window);
  }

  public getRecordingWindow(doctorId: string): WindowInfo | null {
    const group = this.groups.get(doctorId);
    if (!group || !group.recordingWindowId) return null;
    return group.windows.get(group.recordingWindowId) || null;
  }

  // ─────────────────────────────────────────────
  // Cross-Window Communication
  // ─────────────────────────────────────────────

  public broadcastToGroup(doctorId: string, message: object, excludeWindowId?: string): void {
    const group = this.groups.get(doctorId);
    if (!group) return;

    const payload = JSON.stringify(message);

    for (const window of group.windows.values()) {
      if (excludeWindowId && window.id === excludeWindowId) continue;

      if (window.ws.readyState === WebSocket.OPEN) {
        try {
          window.ws.send(payload);
        } catch (err) {
          this.emit('broadcast:error', window.id, err);
        }
      }
    }
  }

  public sendToWindow(windowId: string, message: object): boolean {
    const window = this.windows.get(windowId);
    if (!window || window.ws.readyState !== WebSocket.OPEN) return false;

    try {
      window.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      this.emit('send:error', windowId, err);
      return false;
    }
  }

  public sendToLeader(doctorId: string, message: object): boolean {
    const leader = this.getLeader(doctorId);
    if (!leader) return false;
    return this.sendToWindow(leader.id, message);
  }

  // ─────────────────────────────────────────────
  // State Sync
  // ─────────────────────────────────────────────

  public syncState(doctorId: string, state: object): void {
    this.broadcastToGroup(doctorId, {
      kind: 'state_sync',
      state,
      timestamp: Date.now()
    });
  }

  public syncTranscript(doctorId: string, transcript: {
    text: string;
    speaker: number;
    isFinal: boolean;
  }): void {
    this.broadcastToGroup(doctorId, {
      kind: 'transcript_sync',
      ...transcript,
      timestamp: Date.now()
    });
  }

  // ─────────────────────────────────────────────
  // Health Check
  // ─────────────────────────────────────────────

  public pingWindow(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) return;

    window.lastPingAt = Date.now();
  }

  public getStaleWindows(maxAge: number = 30000): WindowInfo[] {
    const now = Date.now();
    const stale: WindowInfo[] = [];

    for (const window of this.windows.values()) {
      if (now - window.lastPingAt > maxAge) {
        stale.push(window);
      }
    }

    return stale;
  }

  public cleanupStaleWindows(maxAge: number = 60000): number {
    const stale = this.getStaleWindows(maxAge);
    for (const window of stale) {
      this.unregisterWindow(window.id);
    }
    return stale.length;
  }

  // ─────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────

  public getStats(): MultiWindowStats {
    let totalWindows = 0;
    let recordingWindows = 0;
    let leaders = 0;

    for (const window of this.windows.values()) {
      totalWindows++;
      if (window.isRecording) recordingWindows++;
      if (window.isLeader) leaders++;
    }

    return {
      totalGroups: this.groups.size,
      totalWindows,
      recordingWindows,
      leaders,
      doctorIds: Array.from(this.groups.keys())
    };
  }
}

export interface MultiWindowStats {
  totalGroups: number;
  totalWindows: number;
  recordingWindows: number;
  leaders: number;
  doctorIds: string[];
}

export default MultiWindowManager;
