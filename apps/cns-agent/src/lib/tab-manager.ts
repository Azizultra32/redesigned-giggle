/**
 * Tab Manager - Multi-Tab Session Management
 *
 * Manages multiple browser tabs connecting to the backend.
 * Enforces single-active-audio-tab constraint for patient safety.
 * Handles hello, bind_audio, force_bind handshake.
 */

import { WebSocket } from 'ws';

export interface PatientHint {
  name?: string;
  mrn?: string;
  dob?: string;
}

export interface TabSession {
  tabId: string;
  ws: WebSocket;
  url: string;
  title: string;
  patientHint: PatientHint | null;
  domMap: DomField[] | null;
  registeredAt: number;
  lastSeen: number;
}

export interface DomField {
  id: string;
  name: string;
  type: string;
  label: string;
  value?: string;
  xpath?: string;
}

export interface DomMap {
  fields: DomField[];
  patientHint: PatientHint | null;
  timestamp: number;
}

export class TabManager {
  private tabs: Map<string, TabSession> = new Map();
  private activeTabId: string | null = null;
  private activeTranscriptId: number | null = null;
  private activePatientCode: string | null = null;
  private onActiveTabChange?: (tabId: string | null) => void;

  /**
   * Register a new browser tab
   */
  registerTab(
    tabId: string,
    ws: WebSocket,
    url: string,
    title: string,
    patientHint: PatientHint | null
  ): { isActive: boolean; activeTabId: string | null } {
    const session: TabSession = {
      tabId,
      ws,
      url,
      title,
      patientHint,
      domMap: null,
      registeredAt: Date.now(),
      lastSeen: Date.now()
    };

    this.tabs.set(tabId, session);
    console.log(`[TabManager] Tab registered: ${tabId} (${url})`);

    return {
      isActive: this.activeTabId === tabId,
      activeTabId: this.activeTabId
    };
  }

  /**
   * Unregister a tab (on disconnect)
   */
  unregisterTab(tabId: string): void {
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      this.activeTranscriptId = null;
      this.activePatientCode = null;
      console.log(`[TabManager] Active tab disconnected: ${tabId}`);
      this.onActiveTabChange?.(null);
    }

    console.log(`[TabManager] Tab unregistered: ${tabId}`);
  }

  /**
   * Bind audio to a tab (start recording)
   * Returns warning if patient mismatch detected
   */
  bindAudio(
    tabId: string,
    transcriptId: number,
    patientCode: string
  ): { success: boolean; warning?: string; previousTabId?: string } {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return { success: false, warning: 'Tab not registered' };
    }

    // Check for patient mismatch if switching tabs mid-session
    if (this.activeTabId && this.activeTabId !== tabId && this.activePatientCode) {
      const activeTab = this.tabs.get(this.activeTabId);
      if (activeTab?.patientHint?.mrn !== tab.patientHint?.mrn) {
        return {
          success: false,
          warning: `Patient mismatch: active=${activeTab?.patientHint?.name || 'Unknown'}, requested=${tab.patientHint?.name || 'Unknown'}`,
          previousTabId: this.activeTabId
        };
      }
    }

    const previousTabId = this.activeTabId;
    this.activeTabId = tabId;
    this.activeTranscriptId = transcriptId;
    this.activePatientCode = patientCode;

    console.log(`[TabManager] Audio bound to tab: ${tabId}, transcript: ${transcriptId}`);
    this.onActiveTabChange?.(tabId);

    return { success: true, previousTabId: previousTabId || undefined };
  }

  /**
   * Force bind audio to a tab (override patient mismatch warning)
   */
  forceBindAudio(
    tabId: string,
    transcriptId: number,
    patientCode: string
  ): { success: boolean } {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return { success: false };
    }

    const previousTabId = this.activeTabId;
    this.activeTabId = tabId;
    this.activeTranscriptId = transcriptId;
    this.activePatientCode = patientCode;

    console.log(`[TabManager] Force bound audio to tab: ${tabId}`);
    this.onActiveTabChange?.(tabId);

    return { success: true };
  }

  /**
   * Unbind audio (stop recording)
   */
  unbindAudio(): void {
    this.activeTabId = null;
    this.activeTranscriptId = null;
    this.activePatientCode = null;
    console.log(`[TabManager] Audio unbound`);
    this.onActiveTabChange?.(null);
  }

  /**
   * Update DOM map for a tab
   */
  updateDomMap(tabId: string, domMap: DomMap): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.domMap = domMap.fields;
      tab.patientHint = domMap.patientHint || tab.patientHint;
      tab.lastSeen = Date.now();
      console.log(`[TabManager] DOM map updated for tab: ${tabId}, fields: ${domMap.fields.length}`);
    }
  }

  /**
   * Get active tab info
   */
  getActiveTab(): TabSession | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  }

  /**
   * Get active tab ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Get active transcript ID
   */
  getActiveTranscriptId(): number | null {
    return this.activeTranscriptId;
  }

  /**
   * Get all connected tabs
   */
  getAllTabs(): TabSession[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Get tab by ID
   */
  getTab(tabId: string): TabSession | null {
    return this.tabs.get(tabId) || null;
  }

  /**
   * Get tab by WebSocket
   */
  getTabByWebSocket(ws: WebSocket): TabSession | null {
    for (const tab of this.tabs.values()) {
      if (tab.ws === ws) {
        return tab;
      }
    }
    return null;
  }

  /**
   * Get tab count
   */
  getTabCount(): number {
    return this.tabs.size;
  }

  /**
   * Set callback for active tab changes
   */
  setOnActiveTabChange(callback: (tabId: string | null) => void): void {
    this.onActiveTabChange = callback;
  }

  /**
   * Touch tab (update lastSeen)
   */
  touchTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.lastSeen = Date.now();
    }
  }

  /**
   * Cleanup stale tabs (not seen in last 60 seconds)
   */
  cleanupStaleTabs(): string[] {
    const staleThreshold = Date.now() - 60000;
    const staleTabIds: string[] = [];

    for (const [tabId, tab] of this.tabs) {
      if (tab.lastSeen < staleThreshold) {
        staleTabIds.push(tabId);
      }
    }

    for (const tabId of staleTabIds) {
      this.unregisterTab(tabId);
    }

    return staleTabIds;
  }
}
