/**
 * Ferrari Overlay - Main Shadow DOM Application
 *
 * Full implementation with:
 * - 6 tabs: Summary, SOAP, Transcript, Tasks, Patient, Debug
 * - Autopilot pill (red/yellow/green)
 * - Feed A-E indicators
 * - Command bar (MAP/FILL/UNDO/SEND)
 * - State machine integration
 * - Smart fill engine
 */

import { TranscriptView } from './ui/transcript';
import { ControlButtons } from './ui/buttons';
import { TabsComponent } from './ui/tabs';
import { StatusPills } from './ui/pills';
import { Bridge } from './bridge';
import { stateMachine, OverlayStateType, StateEvent } from './state-machine';
import { smartFillEngine, FillStep } from './smart-fill';

export type TabId = 'summary' | 'soap' | 'transcript' | 'tasks' | 'patient' | 'debug';

export type AutopilotStatus = 'red' | 'yellow' | 'green';

export type FeedStatus = 'connected' | 'disconnected' | 'error' | 'ready';

export interface FeedState {
  A: FeedStatus; // Deepgram
  B: FeedStatus; // Voice Concierge
  C: FeedStatus; // Emergency
  D: FeedStatus; // Summary
  E: FeedStatus; // Compliance
}

export interface OverlayState {
  isVisible: boolean;
  isRecording: boolean;
  isConnected: boolean;
  activeTab: TabId;
  transcriptLines: TranscriptLine[];
  patientInfo: PatientInfo | null;
  autopilotStatus: AutopilotStatus;
  autopilotScore: number;
  autopilotSuggestions: string[];
  feeds: FeedState;
  machineState: OverlayStateType;
  tabId: string | null;
  transcriptId: number | null;
  patientCode: string | null;
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
    this.container.id = 'assistmd-overlay';

    // Attach Shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Initialize UI components
    this.transcriptView = new TranscriptView(this.shadowRoot);
    this.controlButtons = new ControlButtons(this.shadowRoot, this.handleControlAction.bind(this));
    this.tabs = new TabsComponent(this.shadowRoot, this.handleTabChange.bind(this));
    this.statusPills = new StatusPills(this.shadowRoot);

    this.setupEventListeners();
    this.setupStateMachine();
    this.render();
  }

  private getInitialState(): OverlayState {
    return {
      isVisible: true,
      isRecording: false,
      isConnected: false,
      activeTab: 'transcript',
      transcriptLines: [],
      patientInfo: null,
      autopilotStatus: 'red',
      autopilotScore: 0,
      autopilotSuggestions: [],
      feeds: {
        A: 'disconnected',
        B: 'disconnected',
        C: 'disconnected',
        D: 'disconnected',
        E: 'disconnected'
      },
      machineState: 'idle',
      tabId: null,
      transcriptId: null,
      patientCode: null
    };
  }

  private setupStateMachine(): void {
    stateMachine.subscribe((prevState, newState, event, context) => {
      this.setState({
        machineState: newState,
        transcriptId: context.transcriptId,
        patientCode: context.patientCode
      });

      // Update recording state based on machine state
      if (newState === 'recording' || newState === 'mapping' || newState === 'filling') {
        this.setState({ isRecording: true });
      } else if (newState === 'idle' || newState === 'done') {
        this.setState({ isRecording: false });
      }
    });
  }

  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridge.on('transcript', (data: TranscriptLine) => {
      this.addTranscriptLine(data);
    });

    this.bridge.on('connection', (status: { connected: boolean }) => {
      this.setState({ isConnected: status.connected });
      if (status.connected) {
        stateMachine.send('CONNECTED');
      }
    });

    this.bridge.on('patient', (info: PatientInfo) => {
      this.setState({ patientInfo: info });
    });

    this.bridge.on('hello_ack', (data: { tabId: string; isActive: boolean }) => {
      this.setState({ tabId: data.tabId });
    });

    this.bridge.on('audio_bound', (data: { tabId: string; transcriptId: number; patientCode: string }) => {
      this.setState({
        transcriptId: data.transcriptId,
        patientCode: data.patientCode
      });
    });

    this.bridge.on('autopilot', (data: { status: AutopilotStatus; score: number; suggestions: string[] }) => {
      this.setState({
        autopilotStatus: data.status,
        autopilotScore: data.score,
        autopilotSuggestions: data.suggestions
      });
      this.updateAutopilotUI();
    });

    this.bridge.on('feed_status', (data: { feed: keyof FeedState; status: FeedStatus }) => {
      this.setState({
        feeds: {
          ...this.state.feeds,
          [data.feed]: data.status
        }
      });
      this.updateFeedIndicators();
    });

    this.bridge.on('command_result', (data: { action: string; success: boolean; steps?: FillStep[] }) => {
      if (data.action === 'fill' && data.success && data.steps) {
        this.executeFillSteps(data.steps);
      } else if (data.action === 'undo' && data.success) {
        this.executeUndo();
      }
    });

    // Keyboard shortcut to toggle overlay
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'g') {
        this.toggleVisibility();
      }
    });
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
        this.sendCommand('map');
        break;
      case 'fill':
        this.sendCommand('fill');
        break;
      case 'undo':
        this.sendCommand('undo');
        break;
      case 'send':
        this.sendCommand('send');
        break;
    }
  }

  private handleTabChange(tab: TabId): void {
    this.setState({ activeTab: tab });
    this.showTabPanel(tab);
  }

  private showTabPanel(tab: TabId): void {
    const panels = this.shadowRoot.querySelectorAll('.tab-panel');
    panels.forEach(panel => {
      panel.classList.add('hidden');
    });

    const activePanel = this.shadowRoot.getElementById(`${tab}-panel`);
    activePanel?.classList.remove('hidden');
  }

  private async startRecording(): Promise<void> {
    if (!stateMachine.canSend('START_RECORD')) {
      console.warn('[Ferrari] Cannot start recording in current state');
      return;
    }

    try {
      // Send hello if not already registered
      if (!this.state.tabId) {
        const tabId = `tab-${Date.now()}`;
        this.bridge.emit('hello', {
          tabId,
          url: window.location.href,
          title: document.title,
          patientHint: this.extractPatientHint()
        });
        this.setState({ tabId });
      }

      // Bind audio and start recording
      this.bridge.emit('bind_audio', {
        tabId: this.state.tabId
      });

      await this.bridge.emit('start-recording', {});
      stateMachine.send('START_RECORD');
    } catch (error) {
      console.error('[Ferrari] Failed to start recording:', error);
      stateMachine.setError('Failed to start recording');
    }
  }

  private extractPatientHint(): PatientInfo | null {
    // Try to extract patient info from the page
    const nameEl = document.querySelector('[data-patient-name], .patient-name, #patient-name');
    const mrnEl = document.querySelector('[data-patient-mrn], .patient-mrn, #patient-mrn');

    if (nameEl || mrnEl) {
      return {
        name: nameEl?.textContent?.trim() || '',
        mrn: mrnEl?.textContent?.trim() || ''
      };
    }

    return null;
  }

  private async stopRecording(): Promise<void> {
    try {
      await this.bridge.emit('stop-recording', {});
      stateMachine.send('STOP_RECORD');
    } catch (error) {
      console.error('[Ferrari] Failed to stop recording:', error);
    }
  }

  private sendCommand(action: 'map' | 'fill' | 'undo' | 'send'): void {
    if (!this.state.tabId) {
      console.warn('[Ferrari] No tab registered');
      return;
    }

    this.bridge.emit('command', {
      action,
      tabId: this.state.tabId
    });

    // Update state machine for certain actions
    if (action === 'map') {
      stateMachine.send('START_MAP');
    } else if (action === 'fill') {
      stateMachine.send('START_FILL');
    } else if (action === 'undo') {
      stateMachine.send('UNDO');
    }
  }

  private async executeFillSteps(steps: FillStep[]): Promise<void> {
    smartFillEngine.setProgressCallback((step, index, total) => {
      this.updateFillProgress(index, total);
    });

    const result = await smartFillEngine.execute(steps);

    if (result.success) {
      stateMachine.send('FILL_COMPLETE');
    }

    this.showFillResult(result);
  }

  private async executeUndo(): Promise<void> {
    const result = await smartFillEngine.undo();
    this.showFillResult(result);
  }

  private updateFillProgress(current: number, total: number): void {
    const progressEl = this.shadowRoot.getElementById('fill-progress');
    if (progressEl) {
      progressEl.textContent = `Filling: ${current}/${total}`;
    }
  }

  private showFillResult(result: { success: boolean; filledCount: number; errors: string[] }): void {
    const statusEl = this.shadowRoot.getElementById('fill-status');
    if (statusEl) {
      if (result.success) {
        statusEl.textContent = `Filled ${result.filledCount} fields`;
        statusEl.className = 'fill-status success';
      } else {
        statusEl.textContent = `Errors: ${result.errors.join(', ')}`;
        statusEl.className = 'fill-status error';
      }
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
      isConnected: this.state.isConnected
    });

    this.statusPills.update({
      isConnected: this.state.isConnected,
      isRecording: this.state.isRecording,
      patientInfo: this.state.patientInfo
    });

    this.tabs.setActiveTab(this.state.activeTab as any);
    this.updateAutopilotUI();
    this.updateFeedIndicators();
    this.updateCommandBar();
  }

  private updateAutopilotUI(): void {
    const pill = this.shadowRoot.getElementById('autopilot-pill');
    if (pill) {
      pill.className = `autopilot-pill ${this.state.autopilotStatus}`;
      pill.textContent = `${this.state.autopilotScore}%`;
    }

    const suggestionsEl = this.shadowRoot.getElementById('autopilot-suggestions');
    if (suggestionsEl) {
      suggestionsEl.innerHTML = this.state.autopilotSuggestions
        .map(s => `<li>${s}</li>`)
        .join('');
    }
  }

  private updateFeedIndicators(): void {
    const feeds = ['A', 'B', 'C', 'D', 'E'] as const;
    for (const feed of feeds) {
      const indicator = this.shadowRoot.getElementById(`feed-${feed}`);
      if (indicator) {
        indicator.className = `feed-indicator ${this.state.feeds[feed]}`;
      }
    }
  }

  private updateCommandBar(): void {
    const mapBtn = this.shadowRoot.getElementById('cmd-map');
    const fillBtn = this.shadowRoot.getElementById('cmd-fill');
    const undoBtn = this.shadowRoot.getElementById('cmd-undo');
    const sendBtn = this.shadowRoot.getElementById('cmd-send');

    // Enable/disable based on state
    const canCommand = stateMachine.canIssueCommands();
    const canUndo = smartFillEngine.canUndo();

    if (mapBtn) (mapBtn as HTMLButtonElement).disabled = !canCommand;
    if (fillBtn) (fillBtn as HTMLButtonElement).disabled = !canCommand;
    if (undoBtn) (undoBtn as HTMLButtonElement).disabled = !canUndo;
    if (sendBtn) (sendBtn as HTMLButtonElement).disabled = !canCommand;
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
          <span class="logo">A</span>
          <span>ASSISTMD</span>
        </div>
        <div class="header-pills" id="status-pills"></div>
        <div id="autopilot-pill" class="autopilot-pill red">0%</div>
        <div class="header-controls">
          <button class="minimize-btn" title="Minimize (Alt+G)">−</button>
        </div>
      </div>

      <div class="feed-bar">
        <div id="feed-A" class="feed-indicator disconnected" title="Feed A: Deepgram">A</div>
        <div id="feed-B" class="feed-indicator disconnected" title="Feed B: Voice">B</div>
        <div id="feed-C" class="feed-indicator disconnected" title="Feed C: Emergency">C</div>
        <div id="feed-D" class="feed-indicator disconnected" title="Feed D: Summary">D</div>
        <div id="feed-E" class="feed-indicator disconnected" title="Feed E: Compliance">E</div>
      </div>

      <div class="overlay-tabs" id="tabs-container">
        <button class="tab-btn active" data-tab="summary">Summary</button>
        <button class="tab-btn" data-tab="soap">SOAP</button>
        <button class="tab-btn" data-tab="transcript">Transcript</button>
        <button class="tab-btn" data-tab="tasks">Tasks</button>
        <button class="tab-btn" data-tab="patient">Patient</button>
        <button class="tab-btn" data-tab="debug">Debug</button>
      </div>

      <div class="overlay-content">
        <div class="tab-panel" id="summary-panel">
          <h3>Clinical Summary</h3>
          <div id="autopilot-suggestions" class="suggestions-list"></div>
        </div>

        <div class="tab-panel hidden" id="soap-panel">
          <h3>SOAP Note</h3>
          <div class="soap-section">
            <h4>Subjective</h4>
            <div id="soap-subjective" class="soap-content">-</div>
          </div>
          <div class="soap-section">
            <h4>Objective</h4>
            <div id="soap-objective" class="soap-content">-</div>
          </div>
          <div class="soap-section">
            <h4>Assessment</h4>
            <div id="soap-assessment" class="soap-content">-</div>
          </div>
          <div class="soap-section">
            <h4>Plan</h4>
            <div id="soap-plan" class="soap-content">-</div>
          </div>
        </div>

        <div class="tab-panel hidden" id="transcript-panel"></div>

        <div class="tab-panel hidden" id="tasks-panel">
          <h3>Tasks</h3>
          <div id="tasks-list" class="tasks-list">
            <p class="empty-state">No tasks extracted yet</p>
          </div>
        </div>

        <div class="tab-panel hidden" id="patient-panel">
          <h3>Patient Info</h3>
          <div id="patient-details" class="patient-details">
            <p class="empty-state">No patient detected</p>
          </div>
        </div>

        <div class="tab-panel hidden" id="debug-panel">
          <h3>Debug</h3>
          <div class="debug-info">
            <div>State: <span id="debug-state">idle</span></div>
            <div>Tab ID: <span id="debug-tabid">-</span></div>
            <div>Transcript ID: <span id="debug-transcriptid">-</span></div>
            <div>Patient Code: <span id="debug-patientcode">-</span></div>
          </div>
        </div>
      </div>

      <div class="command-bar">
        <button id="cmd-map" class="cmd-btn" title="Map DOM fields">MAP</button>
        <button id="cmd-fill" class="cmd-btn" title="Auto-fill from transcript">FILL</button>
        <button id="cmd-undo" class="cmd-btn" title="Undo last fill">UNDO</button>
        <button id="cmd-send" class="cmd-btn" title="Submit form">SEND</button>
      </div>

      <div class="overlay-footer" id="control-buttons">
        <div id="fill-progress" class="fill-progress"></div>
        <div id="fill-status" class="fill-status"></div>
      </div>
    `;

    this.shadowRoot.appendChild(overlay);

    // Mount transcript view
    const transcriptPanel = this.shadowRoot.getElementById('transcript-panel');
    if (transcriptPanel) this.transcriptView.mount(transcriptPanel);

    // Mount control buttons
    const controlsContainer = this.shadowRoot.getElementById('control-buttons');
    if (controlsContainer) this.controlButtons.mount(controlsContainer);

    // Setup tab buttons
    const tabButtons = this.shadowRoot.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as TabId;
        this.handleTabChange(tab);

        // Update active tab button
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Setup command buttons
    this.shadowRoot.getElementById('cmd-map')?.addEventListener('click', () => this.handleControlAction('map'));
    this.shadowRoot.getElementById('cmd-fill')?.addEventListener('click', () => this.handleControlAction('fill'));
    this.shadowRoot.getElementById('cmd-undo')?.addEventListener('click', () => this.handleControlAction('undo'));
    this.shadowRoot.getElementById('cmd-send')?.addEventListener('click', () => this.handleControlAction('send'));

    // Setup minimize button
    const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.toggleVisibility());

    // Show initial tab
    this.showTabPanel('transcript');
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
        width: 400px;
        max-height: 650px;
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
        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
        color: white;
        gap: 12px;
      }

      .overlay-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.5px;
      }

      .logo {
        width: 24px;
        height: 24px;
        background: white;
        color: #dc2626;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 16px;
      }

      .header-pills {
        flex: 1;
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }

      .autopilot-pill {
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
      }

      .autopilot-pill.red {
        background: #ef4444;
        color: white;
      }

      .autopilot-pill.yellow {
        background: #f59e0b;
        color: black;
      }

      .autopilot-pill.green {
        background: #22c55e;
        color: white;
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

      .feed-bar {
        display: flex;
        gap: 4px;
        padding: 8px 16px;
        background: #16162a;
        border-bottom: 1px solid #2d2d44;
      }

      .feed-indicator {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 600;
        color: white;
        cursor: help;
      }

      .feed-indicator.connected { background: #22c55e; }
      .feed-indicator.disconnected { background: #6b7280; }
      .feed-indicator.error { background: #ef4444; }
      .feed-indicator.ready { background: #3b82f6; }

      .overlay-tabs {
        display: flex;
        background: #16162a;
        border-bottom: 1px solid #2d2d44;
        overflow-x: auto;
      }

      .tab-btn {
        padding: 8px 12px;
        background: transparent;
        border: none;
        color: #9ca3af;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
        border-bottom: 2px solid transparent;
      }

      .tab-btn:hover {
        color: white;
      }

      .tab-btn.active {
        color: #dc2626;
        border-bottom-color: #dc2626;
      }

      .overlay-content {
        flex: 1;
        overflow: hidden;
        background: #1a1a2e;
        min-height: 300px;
      }

      .tab-panel {
        height: 100%;
        padding: 12px;
        overflow-y: auto;
        color: #e5e7eb;
      }

      .tab-panel.hidden {
        display: none;
      }

      .tab-panel h3 {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 12px;
        color: white;
      }

      .tab-panel h4 {
        font-size: 12px;
        font-weight: 600;
        color: #9ca3af;
        margin-bottom: 4px;
      }

      .empty-state {
        color: #6b7280;
        font-size: 13px;
        font-style: italic;
      }

      .suggestions-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .suggestions-list li {
        padding: 8px 12px;
        background: #1f1f3a;
        border-radius: 4px;
        margin-bottom: 4px;
        font-size: 12px;
        color: #f59e0b;
      }

      .soap-section {
        margin-bottom: 16px;
      }

      .soap-content {
        padding: 8px 12px;
        background: #16162a;
        border-radius: 6px;
        font-size: 13px;
        min-height: 40px;
      }

      .tasks-list {
        list-style: none;
        padding: 0;
      }

      .patient-details {
        padding: 12px;
        background: #16162a;
        border-radius: 6px;
      }

      .debug-info {
        font-family: monospace;
        font-size: 11px;
        color: #9ca3af;
      }

      .debug-info div {
        padding: 4px 0;
        border-bottom: 1px solid #2d2d44;
      }

      .debug-info span {
        color: #22c55e;
      }

      .command-bar {
        display: flex;
        gap: 8px;
        padding: 8px 16px;
        background: #16162a;
        border-top: 1px solid #2d2d44;
      }

      .cmd-btn {
        flex: 1;
        padding: 8px 12px;
        background: #2d2d44;
        border: 1px solid #3d3d5c;
        border-radius: 6px;
        color: white;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .cmd-btn:hover:not(:disabled) {
        background: #3d3d5c;
        border-color: #dc2626;
      }

      .cmd-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .overlay-footer {
        padding: 8px 16px;
        background: #16162a;
        border-top: 1px solid #2d2d44;
        min-height: 40px;
      }

      .fill-progress {
        font-size: 11px;
        color: #9ca3af;
      }

      .fill-status {
        font-size: 11px;
        margin-top: 4px;
      }

      .fill-status.success {
        color: #22c55e;
      }

      .fill-status.error {
        color: #ef4444;
      }

      /* Scrollbar styling */
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
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
