/**
 * Ferrari Overlay - Full Feature UI
 *
 * Complete overlay with:
 * - SOAP, Summary, Tasks, Transcript tabs
 * - Autopilot pill (red/yellow/green)
 * - Multi-feed status (Feeds A-E)
 * - State machine integration
 * - Smart Fill controls
 */

import { TranscriptView } from './ui/transcript';
import { ControlButtons } from './ui/buttons';
import { TabsComponent } from './ui/tabs';
import { StatusPills } from './ui/pills';
import { Bridge } from './bridge';
import { stateMachine, StateContext, OverlayState as MachineState } from './state-machine';
import { smartFillEngine, FillStep, FillReport } from './smart-fill';

export type TabName = 'transcript' | 'soap' | 'summary' | 'tasks';
export type AutopilotStatus = 'red' | 'yellow' | 'green';
export type FeedStatus = 'connected' | 'disconnected' | 'error' | 'ready';

export interface FeedInfo {
  id: 'A' | 'B' | 'C' | 'D' | 'E';
  label: string;
  status: FeedStatus;
}

export interface OverlayUIState {
  isVisible: boolean;
  isRecording: boolean;
  isConnected: boolean;
  activeTab: TabName;
  transcriptLines: TranscriptLine[];
  patientInfo: PatientInfo | null;
  autopilotStatus: AutopilotStatus;
  autopilotScore: number;
  feeds: FeedInfo[];
  machineState: MachineState;
  fillProgress: number | null;
  suggestions: string[];
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
  patientCode?: string;
}

export interface SOAPNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

export class FerrariOverlay {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement;
  private state: OverlayUIState;
  private bridge: Bridge;

  // UI Components
  private transcriptView: TranscriptView;
  private controlButtons: ControlButtons;
  private tabs: TabsComponent;
  private statusPills: StatusPills;

  // Content storage
  private soapNote: SOAPNote = { subjective: '', objective: '', assessment: '', plan: '' };
  private summary: string = '';
  private tasks: Task[] = [];

  constructor(bridge: Bridge) {
    this.bridge = bridge;
    this.state = this.getInitialState();

    // Create host element
    this.container = document.createElement('div');
    this.container.id = 'ghost-overlay';

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

  private getInitialState(): OverlayUIState {
    return {
      isVisible: true,
      isRecording: false,
      isConnected: false,
      activeTab: 'transcript',
      transcriptLines: [],
      patientInfo: null,
      autopilotStatus: 'red',
      autopilotScore: 0,
      feeds: [
        { id: 'A', label: 'Deepgram', status: 'disconnected' },
        { id: 'B', label: 'Voice', status: 'disconnected' },
        { id: 'C', label: 'Emergency', status: 'disconnected' },
        { id: 'D', label: 'Summary', status: 'disconnected' },
        { id: 'E', label: 'Compliance', status: 'disconnected' }
      ],
      machineState: 'idle',
      fillProgress: null,
      suggestions: []
    };
  }

  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridge.on('transcript', (data: TranscriptLine) => {
      this.addTranscriptLine(data);
    });

    this.bridge.on('connection', (status: { connected: boolean }) => {
      this.setState({ isConnected: status.connected });
      if (status.connected) {
        stateMachine.transition('CONNECTED');
      }
    });

    this.bridge.on('patient', (info: PatientInfo) => {
      this.setState({ patientInfo: info });
    });

    this.bridge.on('autopilot', (data: { status: AutopilotStatus; score: number; suggestions: string[] }) => {
      this.setState({
        autopilotStatus: data.status,
        autopilotScore: data.score,
        suggestions: data.suggestions
      });
      stateMachine.updateContext({ autopilotStatus: data.status });
    });

    this.bridge.on('feed_status', (feed: FeedInfo) => {
      const feeds = this.state.feeds.map(f => f.id === feed.id ? feed : f);
      this.setState({ feeds });
    });

    this.bridge.on('command_result', (result: any) => {
      if (result.tasks && result.command === 'fill') {
        this.executeFillSteps(result.tasks);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'g') {
        this.toggleVisibility();
      }
      if (e.altKey && e.key === 'r') {
        if (this.state.isRecording) {
          this.stopRecording();
        } else {
          this.startRecording();
        }
      }
    });
  }

  private setupStateMachine(): void {
    stateMachine.subscribe((context: StateContext) => {
      this.setState({
        machineState: context.state,
        autopilotStatus: context.autopilotStatus
      });
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
        this.mapFields();
        break;
      case 'fill':
        this.triggerSmartFill();
        break;
      case 'undo':
        this.undoFill();
        break;
      case 'send':
        this.sendForm();
        break;
    }
  }

  private handleTabChange(tab: TabName): void {
    this.setState({ activeTab: tab });
    this.updateTabPanels();
  }

  private async startRecording(): Promise<void> {
    try {
      stateMachine.transition('CONNECT');
      await this.bridge.emit('start-recording', {});
      stateMachine.transition('START_RECORD');
      this.setState({ isRecording: true });
    } catch (error) {
      console.error('[Ferrari] Failed to start recording:', error);
      stateMachine.setError('Failed to start recording');
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      await this.bridge.emit('stop-recording', {});
      stateMachine.transition('STOP_RECORD');
      this.setState({ isRecording: false });
    } catch (error) {
      console.error('[Ferrari] Failed to stop recording:', error);
    }
  }

  private clearTranscript(): void {
    this.setState({ transcriptLines: [] });
    this.transcriptView.clear();
  }

  private async mapFields(): Promise<void> {
    stateMachine.transition('START_MAP');
    await this.bridge.emit('map-fields', {});
    // Response handled in command_result event
  }

  private async triggerSmartFill(): Promise<void> {
    stateMachine.transition('START_FILL');
    const transcript = this.state.transcriptLines.map(l => l.text).join(' ');
    await this.bridge.emit('command', {
      action: 'fill',
      payload: { transcript }
    });
  }

  private async executeFillSteps(steps: FillStep[]): Promise<void> {
    try {
      const report = await smartFillEngine.execute(steps, (index, total) => {
        this.setState({ fillProgress: Math.round((index / total) * 100) });
      });

      stateMachine.transition('FILL_COMPLETE');
      stateMachine.updateContext({
        filledCount: report.completed,
        fieldsCount: report.totalSteps
      });

      this.setState({ fillProgress: null });
    } catch (error) {
      console.error('[Ferrari] Smart Fill failed:', error);
      stateMachine.setError('Smart Fill failed');
    }
  }

  private async undoFill(): Promise<void> {
    stateMachine.transition('UNDO');
    const undoneCount = await smartFillEngine.undo();
    console.log(`[Ferrari] Undid ${undoneCount} fill operations`);
  }

  private async sendForm(): Promise<void> {
    await this.bridge.emit('command', { action: 'send' });
    stateMachine.transition('CONFIRM');
  }

  private addTranscriptLine(line: TranscriptLine): void {
    const lines = [...this.state.transcriptLines];

    const existingIndex = lines.findIndex(l => l.id === line.id);
    if (existingIndex >= 0) {
      lines[existingIndex] = line;
    } else {
      lines.push(line);
    }

    this.setState({ transcriptLines: lines });
    this.transcriptView.updateLines(lines);

    // Update SOAP note from transcript (basic extraction)
    this.updateSOAPFromTranscript(lines);
  }

  private updateSOAPFromTranscript(lines: TranscriptLine[]): void {
    const text = lines.filter(l => l.isFinal).map(l => l.text).join(' ');

    // Very basic extraction - would be enhanced with AI
    if (text.toLowerCase().includes('complain')) {
      this.soapNote.subjective = text;
    }
  }

  private toggleVisibility(): void {
    const newVisibility = !this.state.isVisible;
    this.setState({ isVisible: newVisibility });
    this.container.style.display = newVisibility ? 'block' : 'none';
  }

  private setState(partial: Partial<OverlayUIState>): void {
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

    this.tabs.setActiveTab(this.state.activeTab);
    this.updateAutopilotPill();
    this.updateFeedIndicators();
    this.updateTabPanels();
  }

  private updateAutopilotPill(): void {
    const pill = this.shadowRoot.getElementById('autopilot-pill');
    if (!pill) return;

    const colors = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' };
    pill.style.backgroundColor = colors[this.state.autopilotStatus];
    pill.setAttribute('data-score', `${this.state.autopilotScore}%`);
    pill.title = `Coverage: ${this.state.autopilotScore}%`;
  }

  private updateFeedIndicators(): void {
    for (const feed of this.state.feeds) {
      const indicator = this.shadowRoot.getElementById(`feed-${feed.id}`);
      if (indicator) {
        const colors = {
          connected: '#22c55e',
          disconnected: '#6b7280',
          error: '#ef4444',
          ready: '#3b82f6'
        };
        indicator.style.backgroundColor = colors[feed.status];
        indicator.title = `${feed.label}: ${feed.status}`;
      }
    }
  }

  private updateTabPanels(): void {
    const panels = ['transcript', 'soap', 'summary', 'tasks'];
    for (const panel of panels) {
      const el = this.shadowRoot.getElementById(`${panel}-panel`);
      if (el) {
        el.classList.toggle('hidden', panel !== this.state.activeTab);
      }
    }

    // Update panel content based on active tab
    if (this.state.activeTab === 'soap') {
      this.renderSOAPPanel();
    } else if (this.state.activeTab === 'summary') {
      this.renderSummaryPanel();
    } else if (this.state.activeTab === 'tasks') {
      this.renderTasksPanel();
    }
  }

  private renderSOAPPanel(): void {
    const panel = this.shadowRoot.getElementById('soap-panel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="soap-section">
        <h4>Subjective</h4>
        <textarea id="soap-s" placeholder="Chief complaint, HPI...">${this.soapNote.subjective}</textarea>
      </div>
      <div class="soap-section">
        <h4>Objective</h4>
        <textarea id="soap-o" placeholder="Vitals, physical exam...">${this.soapNote.objective}</textarea>
      </div>
      <div class="soap-section">
        <h4>Assessment</h4>
        <textarea id="soap-a" placeholder="Diagnosis, impression...">${this.soapNote.assessment}</textarea>
      </div>
      <div class="soap-section">
        <h4>Plan</h4>
        <textarea id="soap-p" placeholder="Treatment plan...">${this.soapNote.plan}</textarea>
      </div>
    `;

    // Add change listeners
    ['s', 'o', 'a', 'p'].forEach(key => {
      const textarea = this.shadowRoot.getElementById(`soap-${key}`) as HTMLTextAreaElement;
      textarea?.addEventListener('input', () => {
        const prop = { s: 'subjective', o: 'objective', a: 'assessment', p: 'plan' }[key] as keyof SOAPNote;
        this.soapNote[prop] = textarea.value;
      });
    });
  }

  private renderSummaryPanel(): void {
    const panel = this.shadowRoot.getElementById('summary-panel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="summary-container">
        <h4>Session Summary</h4>
        <div class="summary-content">${this.summary || 'Summary will appear here after recording...'}</div>
        <div class="suggestions-section">
          <h4>Suggestions</h4>
          <ul class="suggestions-list">
            ${this.state.suggestions.map(s => `<li>${s}</li>`).join('') || '<li>No suggestions yet</li>'}
          </ul>
        </div>
      </div>
    `;
  }

  private renderTasksPanel(): void {
    const panel = this.shadowRoot.getElementById('tasks-panel');
    if (!panel) return;

    const tasksByPriority = {
      high: this.tasks.filter(t => t.priority === 'high'),
      medium: this.tasks.filter(t => t.priority === 'medium'),
      low: this.tasks.filter(t => t.priority === 'low')
    };

    panel.innerHTML = `
      <div class="tasks-container">
        <div class="task-section">
          <h4>High Priority</h4>
          ${this.renderTaskList(tasksByPriority.high)}
        </div>
        <div class="task-section">
          <h4>Medium Priority</h4>
          ${this.renderTaskList(tasksByPriority.medium)}
        </div>
        <div class="task-section">
          <h4>Low Priority</h4>
          ${this.renderTaskList(tasksByPriority.low)}
        </div>
      </div>
    `;
  }

  private renderTaskList(tasks: Task[]): string {
    if (tasks.length === 0) return '<p class="no-tasks">No tasks</p>';

    return `<ul class="task-list">
      ${tasks.map(t => `
        <li class="task-item task-${t.status}">
          <span class="task-status">${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}</span>
          <span class="task-desc">${t.description}</span>
        </li>
      `).join('')}
    </ul>`;
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
          <span class="logo">GHOST</span>
        </div>
        <div class="autopilot-container">
          <div id="autopilot-pill" class="autopilot-pill" title="Autopilot Status"></div>
        </div>
        <div class="feeds-container">
          ${this.state.feeds.map(f => `<div id="feed-${f.id}" class="feed-indicator" title="${f.label}"></div>`).join('')}
        </div>
        <div class="header-controls">
          <button class="minimize-btn" title="Minimize (Alt+G)">−</button>
        </div>
      </div>
      <div class="patient-card" id="patient-card">
        <span class="patient-name">${this.state.patientInfo?.name || 'No patient'}</span>
        <span class="patient-mrn">${this.state.patientInfo?.mrn || ''}</span>
        <span class="patient-code">${this.state.patientInfo?.patientCode || ''}</span>
      </div>
      <div class="state-indicator" id="state-indicator">
        ${stateMachine.getDisplayInfo().icon} ${stateMachine.getDisplayInfo().label}
      </div>
      <div class="header-pills" id="status-pills"></div>
      <div class="overlay-tabs" id="tabs-container"></div>
      <div class="overlay-content">
        <div class="tab-panel" id="transcript-panel"></div>
        <div class="tab-panel hidden" id="soap-panel"></div>
        <div class="tab-panel hidden" id="summary-panel"></div>
        <div class="tab-panel hidden" id="tasks-panel"></div>
      </div>
      <div class="command-bar" id="command-bar">
        <button class="cmd-btn" data-action="map" title="Map DOM Fields">MAP</button>
        <button class="cmd-btn" data-action="fill" title="Smart Fill">FILL</button>
        <button class="cmd-btn" data-action="undo" title="Undo Fill">UNDO</button>
        <button class="cmd-btn" data-action="send" title="Send/Submit">SEND</button>
      </div>
      <div class="overlay-footer" id="control-buttons"></div>
    `;

    this.shadowRoot.appendChild(overlay);

    // Mount components
    const pillsContainer = this.shadowRoot.getElementById('status-pills');
    const tabsContainer = this.shadowRoot.getElementById('tabs-container');
    const transcriptPanel = this.shadowRoot.getElementById('transcript-panel');
    const controlsContainer = this.shadowRoot.getElementById('control-buttons');

    if (pillsContainer) this.statusPills.mount(pillsContainer);
    if (tabsContainer) this.tabs.mount(tabsContainer);
    if (transcriptPanel) this.transcriptView.mount(transcriptPanel);
    if (controlsContainer) this.controlButtons.mount(controlsContainer);

    // Setup minimize button
    const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.toggleVisibility());

    // Setup command bar buttons
    const cmdBtns = this.shadowRoot.querySelectorAll('.cmd-btn');
    cmdBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        if (action) this.handleControlAction(action);
      });
    });
  }

  private getStyles(): string {
    return `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .ferrari-overlay {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 400px;
        max-height: 700px;
        background: #1a1a2e;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #2d2d44;
        color: #e5e7eb;
      }

      .overlay-header {
        display: flex;
        align-items: center;
        padding: 10px 16px;
        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
        color: white;
        gap: 10px;
      }

      .overlay-title {
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 1px;
      }

      .logo { color: #fff; }

      .autopilot-container {
        margin-left: auto;
      }

      .autopilot-pill {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ef4444;
        transition: background-color 0.3s;
        cursor: pointer;
      }

      .feeds-container {
        display: flex;
        gap: 4px;
      }

      .feed-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #6b7280;
        transition: background-color 0.3s;
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
      }

      .patient-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        background: #16162a;
        border-bottom: 1px solid #2d2d44;
        font-size: 12px;
      }

      .patient-name {
        font-weight: 600;
        color: #fff;
      }

      .patient-mrn, .patient-code {
        color: #9ca3af;
        font-size: 11px;
      }

      .state-indicator {
        padding: 6px 16px;
        background: #1f1f3a;
        font-size: 11px;
        color: #9ca3af;
        border-bottom: 1px solid #2d2d44;
      }

      .header-pills {
        display: flex;
        gap: 6px;
        padding: 6px 16px;
        background: #16162a;
        border-bottom: 1px solid #2d2d44;
      }

      .overlay-tabs {
        background: #16162a;
        border-bottom: 1px solid #2d2d44;
      }

      .overlay-content {
        flex: 1;
        overflow: hidden;
        background: #1a1a2e;
        min-height: 200px;
      }

      .tab-panel {
        height: 100%;
        padding: 12px;
        overflow-y: auto;
      }

      .tab-panel.hidden {
        display: none;
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
        padding: 8px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s;
      }

      .cmd-btn:hover {
        background: #2563eb;
      }

      .cmd-btn[data-action="fill"] { background: #8b5cf6; }
      .cmd-btn[data-action="fill"]:hover { background: #7c3aed; }
      .cmd-btn[data-action="undo"] { background: #f59e0b; }
      .cmd-btn[data-action="undo"]:hover { background: #d97706; }
      .cmd-btn[data-action="send"] { background: #22c55e; }
      .cmd-btn[data-action="send"]:hover { background: #16a34a; }

      .overlay-footer {
        padding: 12px 16px;
        background: #16162a;
        border-top: 1px solid #2d2d44;
      }

      /* SOAP Panel */
      .soap-section {
        margin-bottom: 12px;
      }

      .soap-section h4 {
        font-size: 11px;
        color: #9ca3af;
        margin: 0 0 4px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .soap-section textarea {
        width: 100%;
        min-height: 60px;
        background: #16162a;
        border: 1px solid #2d2d44;
        border-radius: 6px;
        color: #e5e7eb;
        padding: 8px;
        font-size: 12px;
        resize: vertical;
      }

      /* Summary Panel */
      .summary-container h4 {
        font-size: 11px;
        color: #9ca3af;
        margin: 0 0 8px 0;
        text-transform: uppercase;
      }

      .summary-content {
        background: #16162a;
        border-radius: 6px;
        padding: 12px;
        font-size: 12px;
        line-height: 1.5;
        min-height: 80px;
      }

      .suggestions-section {
        margin-top: 16px;
      }

      .suggestions-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .suggestions-list li {
        padding: 6px 8px;
        background: #1f1f3a;
        border-radius: 4px;
        margin-bottom: 4px;
        font-size: 11px;
        color: #f59e0b;
      }

      /* Tasks Panel */
      .task-section {
        margin-bottom: 16px;
      }

      .task-section h4 {
        font-size: 11px;
        color: #9ca3af;
        margin: 0 0 8px 0;
        text-transform: uppercase;
      }

      .task-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .task-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: #16162a;
        border-radius: 4px;
        margin-bottom: 4px;
        font-size: 12px;
      }

      .task-status { font-size: 14px; }
      .task-completed .task-desc { text-decoration: line-through; color: #6b7280; }

      .no-tasks {
        color: #6b7280;
        font-size: 11px;
        font-style: italic;
      }

      /* Scrollbar */
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: #1a1a2e; }
      ::-webkit-scrollbar-thumb { background: #3d3d5c; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #4d4d6c; }
    `;
  }

  public mount(): void {
    document.body.appendChild(this.container);
  }

  public unmount(): void {
    this.container.remove();
  }

  public getState(): OverlayUIState {
    return { ...this.state };
  }
}
