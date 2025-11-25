/**
 * Tab Manager - Multi-tab EHR session management
 *
 * Handles multiple Chrome tabs connecting to the same backend:
 * - Only ONE tab can be "active" for audio recording at a time
 * - Patient identity safety (no cross-patient contamination)
 * - Tab registry and lifecycle management
 */

import { WebSocket } from 'ws';
import { DomMap } from '../types/index.js';

export interface TabSession {
  tabId: string;
  ws: WebSocket;
  url: string;
  title: string;
  patientHint?: {
    name?: string;
    mrn?: string;
    dob?: string;
  };
  isActive: boolean;
  lastSeen: number;
  transcriptId: number | null;
  domMap: DomMap | null;
}

export interface TabHello {
  type: 'hello';
  tabId: string;
  url: string;
  title: string;
  patientHint?: {
    name?: string;
    mrn?: string;
    dob?: string;
  };
}

export interface TabBindAudio {
  type: 'bind_audio';
  tabId: string;
}

export interface PatientMismatchWarning {
  type: 'warning';
  code: 'PATIENT_MISMATCH';
  currentPatient: { name?: string; mrn?: string };
  newPatient: { name?: string; mrn?: string };
  message: string;
}

export class TabManager {
  // Registry of connected tabs keyed by tabId
  private tabs: Map<string, TabSession> = new Map();

  // Currently active tab for audio (only one at a time)
  private activeTabId: string | null = null;

  // Listeners for tab events
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  /**
   * Register a new tab connection
   */
  registerTab(hello: TabHello, ws: WebSocket): TabSession {
    const { tabId, url, title, patientHint } = hello;

    // Check if tab already exists (reconnection)
    if (this.tabs.has(tabId)) {
      const existing = this.tabs.get(tabId)!;
      existing.ws = ws;
      existing.url = url;
      existing.title = title;
      existing.patientHint = patientHint;
      existing.lastSeen = Date.now();
      console.log(`[TabManager] Tab reconnected: ${tabId}`);
      return existing;
    }

    // Create new tab session
    const session: TabSession = {
      tabId,
      ws,
      url,
      title,
      patientHint,
      isActive: false,
      lastSeen: Date.now(),
      transcriptId: null,
      domMap: null
    };

    this.tabs.set(tabId, session);
    console.log(`[TabManager] Tab registered: ${tabId} (${url})`);

    this.emit('tab_registered', { tabId, url, patientHint });
    return session;
  }

  /**
   * Unregister a tab (when WebSocket closes)
   */
  unregisterTab(tabId: string): void {
    const session = this.tabs.get(tabId);
    if (!session) return;

    // If this was the active tab, clear active
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      this.broadcastActiveTabChange();
    }

    this.tabs.delete(tabId);
    console.log(`[TabManager] Tab unregistered: ${tabId}`);

    this.emit('tab_unregistered', { tabId });
  }

  /**
   * Bind audio to a specific tab
   * Returns warning if patient mismatch detected
   */
  bindAudio(tabId: string): { success: boolean; warning?: PatientMismatchWarning } {
    const session = this.tabs.get(tabId);
    if (!session) {
      console.error(`[TabManager] Cannot bind audio: tab ${tabId} not found`);
      return { success: false };
    }

    // Check for patient mismatch
    if (this.activeTabId && this.activeTabId !== tabId) {
      const activeSession = this.tabs.get(this.activeTabId);
      if (activeSession?.patientHint && session.patientHint) {
        const currentMRN = activeSession.patientHint.mrn;
        const newMRN = session.patientHint.mrn;

        // If both have MRN and they differ, that's a mismatch
        if (currentMRN && newMRN && currentMRN !== newMRN) {
          return {
            success: false,
            warning: {
              type: 'warning',
              code: 'PATIENT_MISMATCH',
              currentPatient: activeSession.patientHint,
              newPatient: session.patientHint,
              message: `Audio is bound to ${activeSession.patientHint.name || currentMRN}. Switching to ${session.patientHint.name || newMRN} will start a new session.`
            }
          };
        }
      }
    }

    // Unbind previous active tab
    if (this.activeTabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev) prev.isActive = false;
    }

    // Bind new tab
    session.isActive = true;
    this.activeTabId = tabId;

    console.log(`[TabManager] Audio bound to tab: ${tabId}`);
    this.broadcastActiveTabChange();

    return { success: true };
  }

  /**
   * Force bind audio (override patient mismatch warning)
   */
  forceBind(tabId: string): boolean {
    const session = this.tabs.get(tabId);
    if (!session) return false;

    // Unbind previous
    if (this.activeTabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev) {
        prev.isActive = false;
        prev.transcriptId = null; // Clear transcript binding
      }
    }

    // Bind new
    session.isActive = true;
    this.activeTabId = tabId;

    console.log(`[TabManager] Audio force-bound to tab: ${tabId}`);
    this.broadcastActiveTabChange();

    return true;
  }

  /**
   * Unbind audio from current tab
   */
  unbindAudio(): void {
    if (this.activeTabId) {
      const session = this.tabs.get(this.activeTabId);
      if (session) {
        session.isActive = false;
      }
      this.activeTabId = null;
      this.broadcastActiveTabChange();
    }
  }

  /**
   * Get the currently active tab
   */
  getActiveTab(): TabSession | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  /**
   * Get tab by ID
   */
  getTab(tabId: string): TabSession | undefined {
    return this.tabs.get(tabId);
  }

  /**
   * Get all tabs
   */
  getAllTabs(): TabSession[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Get tabs for a specific patient (by MRN)
   */
  getTabsForPatient(mrn: string): TabSession[] {
    return this.getAllTabs().filter(t => t.patientHint?.mrn === mrn);
  }

  /**
   * Update DOM map for a tab
   */
  updateDomMap(tabId: string, domMap: DomMap): void {
    const session = this.tabs.get(tabId);
    if (session) {
      session.domMap = domMap;
      session.lastSeen = Date.now();

      // Update patient hint if DOM map contains patient info
      if (domMap.patientName || domMap.mrn) {
        session.patientHint = {
          ...session.patientHint,
          name: domMap.patientName || session.patientHint?.name,
          mrn: domMap.mrn || session.patientHint?.mrn,
          dob: domMap.dob || session.patientHint?.dob
        };
      }
    }
  }

  /**
   * Set transcript ID for active tab
   */
  setTranscriptId(tabId: string, transcriptId: number): void {
    const session = this.tabs.get(tabId);
    if (session) {
      session.transcriptId = transcriptId;
    }
  }

  /**
   * Broadcast active tab change to all connected tabs
   */
  private broadcastActiveTabChange(): void {
    const message = {
      type: 'active_tab_changed',
      data: {
        tabId: this.activeTabId,
        url: this.activeTabId ? this.tabs.get(this.activeTabId)?.url : null,
        patientHint: this.activeTabId ? this.tabs.get(this.activeTabId)?.patientHint : null
      }
    };

    for (const session of this.tabs.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(message));
      }
    }

    this.emit('active_tab_changed', message.data);
  }

  /**
   * Send message to a specific tab
   */
  sendToTab(tabId: string, message: object): boolean {
    const session = this.tabs.get(tabId);
    if (session && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Broadcast message to all tabs
   */
  broadcast(message: object): void {
    const payload = JSON.stringify(message);
    for (const session of this.tabs.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(payload);
      }
    }
  }

  /**
   * Get tab statistics
   */
  getStats(): {
    totalTabs: number;
    activeTabId: string | null;
    uniquePatients: number;
    tabsByPatient: Map<string, number>;
  } {
    const tabsByPatient = new Map<string, number>();

    for (const session of this.tabs.values()) {
      const mrn = session.patientHint?.mrn || 'unknown';
      tabsByPatient.set(mrn, (tabsByPatient.get(mrn) || 0) + 1);
    }

    return {
      totalTabs: this.tabs.size,
      activeTabId: this.activeTabId,
      uniquePatients: tabsByPatient.size,
      tabsByPatient
    };
  }

  /**
   * Clean up stale tabs (not seen in N minutes)
   */
  cleanupStaleTabs(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [tabId, session] of this.tabs.entries()) {
      if (now - session.lastSeen > maxAgeMs) {
        this.unregisterTab(tabId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[TabManager] Cleaned up ${cleaned} stale tabs`);
    }

    return cleaned;
  }

  // Event emitter methods
  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }
}

// Singleton instance
export const tabManager = new TabManager();
