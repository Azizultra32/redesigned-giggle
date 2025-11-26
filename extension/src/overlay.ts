/**
 * Ferrari Overlay - Main Shadow DOM Application
 *
 * This module creates and manages the overlay UI that floats above
 * the host page. Uses Shadow DOM for style isolation.
 */

import { TranscriptView } from './ui/transcript';
import { ControlButtons } from './ui/buttons';
import { TabsComponent } from './ui/tabs';
import { StatusPills } from './ui/pills';
import { Bridge } from './bridge';

export interface ConsentEvent {
  id: string;
  timestamp: number;
  phrase: string;
}

export interface OverlayState {
  isVisible: boolean;
  isRecording: boolean;
  isConnected: boolean;
  isSpeaking: boolean;
  consentLogged: boolean;
  activeTab: 'live' | 'chat' | 'history';
  transcriptLines: TranscriptLine[];
  consentEvents: ConsentEvent[];
  patientInfo: PatientInfo | null;
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface PatientInfo {
  name: string;
  mrn: string;
  dob?: string;
}

export class FerrariOverlay {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement;
  private state: OverlayState;
  private bridge: Bridge;

  // UI Components
  private transcriptView: TranscriptView;
  private controlButtons: ControlButtons;
  private tabs: TabsComponent;
  private statusPills: StatusPills;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
    this.state = this.getInitialState();

    // Create host element
    this.container = document.createElement('div');
    this.container.id = 'ghost-next-overlay';

    // Attach Shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Initialize UI components
    this.transcriptView = new TranscriptView(this.shadowRoot);
    this.controlButtons = new ControlButtons(this.shadowRoot, this.handleControlAction.bind(this));
    this.tabs = new TabsComponent(this.shadowRoot, this.handleTabChange.bind(this));
    this.statusPills = new StatusPills(this.shadowRoot);

    this.setupEventListeners();
    this.render();
  }

  private getInitialState(): OverlayState {
    return {
      isVisible: true,
      isRecording: false,
      isConnected: false,
      isSpeaking: false,
      consentLogged: false,
      activeTab: 'live',
      transcriptLines: [],
      consentEvents: [],
      patientInfo: null
    };
  }

  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridge.on('transcript', (data: TranscriptLine) => {
      this.addTranscriptLine(data);
    });

    this.bridge.on('connection', (status: { connected: boolean }) => {
      this.setState({ isConnected: status.connected });
    });

    this.bridge.on('patient', (info: PatientInfo) => {
      this.setState({ patientInfo: info });
    });

    // VAD: Speech detection feedback
    this.bridge.on('audio-status', (status: { speaking?: boolean; recording?: boolean }) => {
      if (status.speaking !== undefined) {
        this.setState({ isSpeaking: status.speaking });
      }
    });

    // Consent logged event
    this.bridge.on('consent-logged', (data: { timestamp?: number; phrase?: string } = {}) => {
      const event: ConsentEvent = {
        id: `consent_${Date.now()}`,
        timestamp: data.timestamp || Date.now(),
        phrase: data.phrase || 'Consent granted'
      };
      this.setState({
        consentLogged: true,
        consentEvents: [...this.state.consentEvents, event]
      });
      // Flash the consent badge
      this.flashConsentBadge();
      // Update history panel
      this.updateHistoryPanel();
    });

    // Keyboard shortcut to toggle overlay
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'g') {
        this.toggleVisibility();
      }
    });
  }

  private flashConsentBadge(): void {
    const badge = this.shadowRoot.querySelector('.consent-badge');
    if (badge) {
      badge.classList.add('flash');
      setTimeout(() => badge.classList.remove('flash'), 1000);
    }
  }

  private updateHistoryPanel(): void {
    const historyPanel = this.shadowRoot.getElementById('history-panel');
    if (!historyPanel) return;

    if (this.state.consentEvents.length === 0) {
      historyPanel.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📋</span>
          <p>No Consent Events</p>
          <p class="empty-hint">Say "Assist, consent granted" to log</p>
        </div>
      `;
    } else {
      historyPanel.innerHTML = `
        <div class="consent-list">
          ${this.state.consentEvents.map(e => `
            <div class="consent-item">
              <span class="consent-badge-sm">CONSENT</span>
              <span class="consent-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
              <span class="consent-phrase">${e.phrase}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  private handleControlAction(action: string): void {
    switch (action) {
      case 'start':
        this.startRecording();
        break;
      case 'stop':
        this.stopRecording();
        break;
      case 'clear':
        this.clearTranscript();
        break;
      case 'minimize':
        this.toggleVisibility();
        break;
      case 'map':
        this.bridge.emit('map-fields', {});
        break;
    }
  }

  private handleTabChange(tab: OverlayState['activeTab']): void {
    this.setState({ activeTab: tab });
  }

  private async startRecording(): Promise<void> {
    try {
      await this.bridge.emit('start-recording', {});
      this.setState({ isRecording: true });
    } catch (error) {
      console.error('[Ferrari] Failed to start recording:', error);
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      await this.bridge.emit('stop-recording', {});
      this.setState({ isRecording: false });
    } catch (error) {
      console.error('[Ferrari] Failed to stop recording:', error);
    }
  }

  private clearTranscript(): void {
    this.setState({ transcriptLines: [] });
    this.transcriptView.clear();
  }

  private addTranscriptLine(line: TranscriptLine): void {
    const lines = [...this.state.transcriptLines];

    // Update existing line if not final, or add new
    const existingIndex = lines.findIndex(l => l.id === line.id);
    if (existingIndex >= 0) {
      lines[existingIndex] = line;
    } else {
      lines.push(line);
    }

    this.setState({ transcriptLines: lines });
    this.transcriptView.updateLines(lines);
  }

  private toggleVisibility(): void {
    this.setState({ isVisible: !this.state.isVisible });
    this.container.style.display = this.state.isVisible ? 'block' : 'none';
  }

  private setState(partial: Partial<OverlayState>): void {
    this.state = { ...this.state, ...partial };
    this.updateUI();
  }

  private updateUI(): void {
    this.controlButtons.update({
      isRecording: this.state.isRecording,
      isConnected: this.state.isConnected,
      isSpeaking: this.state.isSpeaking
    });

    this.statusPills.update({
      isConnected: this.state.isConnected,
      isRecording: this.state.isRecording,
      isSpeaking: this.state.isSpeaking,
      consentLogged: this.state.consentLogged,
      patientInfo: this.state.patientInfo
    });

    this.tabs.setActiveTab(this.state.activeTab);

    // Update VAD glow on record button
    const recordBtn = this.shadowRoot.querySelector('.record-btn');
    if (recordBtn) {
      recordBtn.classList.toggle('speaking', this.state.isSpeaking && this.state.isRecording);
    }

    // Update consent badge visibility
    const consentBadge = this.shadowRoot.getElementById('consent-badge');
    if (consentBadge) {
      consentBadge.classList.toggle('visible', this.state.consentLogged);
    }
  }

  private render(): void {
    // Inject styles
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.shadowRoot.appendChild(styles);

    // Create main overlay structure
    const overlay = document.createElement('div');
    overlay.className = 'ferrari-overlay';
    overlay.innerHTML = `
      <div class="overlay-header">
        <div class="overlay-title">
          <span class="logo">🏎️</span>
          <span>GHOST-NEXT</span>
          <span class="consent-badge" id="consent-badge">CONSENT</span>
        </div>
        <div class="header-pills" id="status-pills"></div>
        <div class="header-controls">
          <button class="minimize-btn" title="Minimize (Alt+G)">−</button>
        </div>
      </div>
      <div class="overlay-tabs" id="tabs-container"></div>
      <div class="overlay-content">
        <div class="tab-panel" id="live-panel"></div>
        <div class="tab-panel hidden" id="chat-panel">
          <div class="chat-placeholder">
            <span class="placeholder-icon">💬</span>
            <p>Voice Agent</p>
            <p class="placeholder-hint">Say "Assist, help me..." to start</p>
          </div>
        </div>
        <div class="tab-panel hidden" id="history-panel">
          <div class="empty-state">
            <span class="empty-icon">📋</span>
            <p>No Consent Events</p>
            <p class="empty-hint">Say "Assist, consent granted" to log</p>
          </div>
        </div>
      </div>
      <div class="overlay-footer" id="control-buttons"></div>
    `;

    this.shadowRoot.appendChild(overlay);

    // Mount components
    const pillsContainer = this.shadowRoot.getElementById('status-pills');
    const tabsContainer = this.shadowRoot.getElementById('tabs-container');
    const livePanel = this.shadowRoot.getElementById('live-panel');
    const controlsContainer = this.shadowRoot.getElementById('control-buttons');

    if (pillsContainer) this.statusPills.mount(pillsContainer);
    if (tabsContainer) this.tabs.mount(tabsContainer);
    if (livePanel) this.transcriptView.mount(livePanel);
    if (controlsContainer) this.controlButtons.mount(controlsContainer);

    // Setup minimize button
    const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.toggleVisibility());
  }

  private getStyles(): string {
    return `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      }

      .ferrari-overlay {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 380px;
        max-height: 600px;
        background: #1a1a2e;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #2d2d44;
      }

      .overlay-header {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        background: linear-gradient(135deg, #e63946 0%, #c62828 100%);
        color: white;
        gap: 12px;
      }

      .overlay-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
      }

      .logo {
        font-size: 18px;
      }

      .header-pills {
        flex: 1;
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }

      .header-controls button {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      }

      .header-controls button:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .overlay-tabs {
        background: #16162a;
        border-bottom: 1px solid #2d2d44;
      }

      .overlay-content {
        flex: 1;
        overflow: hidden;
        background: #1a1a2e;
      }

      .tab-panel {
        height: 100%;
        padding: 12px;
        overflow-y: auto;
      }

      .tab-panel.hidden {
        display: none;
      }

      .overlay-footer {
        padding: 12px 16px;
        background: #16162a;
        border-top: 1px solid #2d2d44;
      }

      /* Scrollbar styling */
      ::-webkit-scrollbar {
        width: 6px;
      }

      ::-webkit-scrollbar-track {
        background: #1a1a2e;
      }

      ::-webkit-scrollbar-thumb {
        background: #3d3d5c;
        border-radius: 3px;
      }

      ::-webkit-scrollbar-thumb:hover {
        background: #4d4d6c;
      }

      /* VAD Glow Effect - Green glow when speaking */
      .record-btn.speaking {
        animation: vad-glow 0.5s ease-in-out infinite alternate;
        box-shadow: 0 0 20px #22c55e, 0 0 40px #22c55e;
      }

      @keyframes vad-glow {
        from {
          box-shadow: 0 0 10px #22c55e, 0 0 20px #22c55e;
        }
        to {
          box-shadow: 0 0 20px #22c55e, 0 0 40px #22c55e, 0 0 60px #22c55e;
        }
      }

      /* Consent Badge */
      .consent-badge {
        display: none;
        background: #22c55e;
        color: white;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
      }

      .consent-badge.visible {
        display: inline-block;
      }

      .consent-badge.flash {
        animation: consent-flash 1s ease-out;
      }

      @keyframes consent-flash {
        0% { transform: scale(1); background: #22c55e; }
        50% { transform: scale(1.2); background: #4ade80; }
        100% { transform: scale(1); background: #22c55e; }
      }

      /* Placeholder and Empty States */
      .chat-placeholder,
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: #888;
        text-align: center;
      }

      .placeholder-icon,
      .empty-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.6;
      }

      .placeholder-hint,
      .empty-hint {
        font-size: 12px;
        color: #666;
        margin-top: 4px;
      }

      /* History Panel - Consent List */
      .consent-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .consent-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #232340;
        border-radius: 6px;
        font-size: 12px;
      }

      .consent-badge-sm {
        background: #22c55e;
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 9px;
        font-weight: 600;
      }

      .consent-time {
        color: #888;
        font-size: 11px;
      }

      .consent-phrase {
        color: #ccc;
        flex: 1;
      }
    `;
  }

  public mount(): void {
    document.body.appendChild(this.container);
  }

  public unmount(): void {
    this.container.remove();
  }

  public getState(): OverlayState {
    return { ...this.state };
  }
}
