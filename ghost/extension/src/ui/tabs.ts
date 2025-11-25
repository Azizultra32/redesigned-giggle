/**
 * Tabs Component
 *
 * Tab navigation for switching between overlay panels:
 * - Transcript: Real-time diarized transcript
 * - SOAP: Structured clinical note editor
 * - Summary: AI-generated session summary
 * - Tasks: Action items and follow-ups
 */

export type TabId = 'transcript' | 'soap' | 'summary' | 'tasks';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  shortcut?: string;
}

const TABS: Tab[] = [
  { id: 'transcript', label: 'Transcript', icon: '📝', shortcut: '1' },
  { id: 'soap', label: 'SOAP', icon: '📋', shortcut: '2' },
  { id: 'summary', label: 'Summary', icon: '📊', shortcut: '3' },
  { id: 'tasks', label: 'Tasks', icon: '✓', shortcut: '4' }
];

export class TabsComponent {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private activeTab: TabId = 'transcript';
  private onTabChange: (tab: TabId) => void;

  constructor(shadowRoot: ShadowRoot, onTabChange: (tab: TabId) => void) {
    this.shadowRoot = shadowRoot;
    this.onTabChange = onTabChange;
    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      // Alt + number for tab switching
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const tab = TABS.find(t => t.shortcut === e.key);
        if (tab) {
          e.preventDefault();
          this.setActiveTab(tab.id);
          this.onTabChange(tab.id);
        }
      }
    });
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public setActiveTab(tabId: TabId): void {
    this.activeTab = tabId;
    this.updateActiveState();
  }

  public getActiveTab(): TabId {
    return this.activeTab;
  }

  private render(): void {
    if (!this.container) return;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
      .tabs-container {
        display: flex;
        padding: 0;
        background: #16162a;
      }

      .tab-button {
        flex: 1;
        padding: 10px 8px;
        background: transparent;
        border: none;
        color: #6b7280;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border-bottom: 2px solid transparent;
        position: relative;
      }

      .tab-button:hover {
        color: #9ca3af;
        background: rgba(255, 255, 255, 0.03);
      }

      .tab-button.active {
        color: #dc2626;
        border-bottom-color: #dc2626;
        background: rgba(220, 38, 38, 0.05);
      }

      .tab-icon {
        font-size: 12px;
      }

      .tab-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .tab-shortcut {
        position: absolute;
        top: 2px;
        right: 4px;
        font-size: 8px;
        color: #4b5563;
        opacity: 0.5;
      }

      .tab-badge {
        position: absolute;
        top: 4px;
        right: 8px;
        min-width: 14px;
        height: 14px;
        background: #dc2626;
        color: white;
        font-size: 9px;
        font-weight: 600;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 3px;
      }

      .tab-badge.hidden {
        display: none;
      }
    `;

    // Create tabs
    const tabsWrapper = document.createElement('div');
    tabsWrapper.className = 'tabs-container';

    TABS.forEach(tab => {
      const button = document.createElement('button');
      button.className = `tab-button ${tab.id === this.activeTab ? 'active' : ''}`;
      button.dataset.tab = tab.id;
      button.title = `${tab.label} (Alt+${tab.shortcut})`;
      button.innerHTML = `
        <span class="tab-icon">${tab.icon}</span>
        <span class="tab-label">${tab.label}</span>
        <span class="tab-badge hidden" id="badge-${tab.id}">0</span>
      `;

      button.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.updateActiveState();
        this.onTabChange(tab.id);
      });

      tabsWrapper.appendChild(button);
    });

    this.container.appendChild(styles);
    this.container.appendChild(tabsWrapper);
  }

  private updateActiveState(): void {
    if (!this.container) return;

    const buttons = this.container.querySelectorAll('.tab-button');
    buttons.forEach(btn => {
      const button = btn as HTMLElement;
      const isActive = button.dataset.tab === this.activeTab;
      button.classList.toggle('active', isActive);
    });

    // Update panel visibility
    const panels = this.shadowRoot.querySelectorAll('.tab-panel');
    panels.forEach(panel => {
      const panelEl = panel as HTMLElement;
      const panelId = panelEl.id.replace('-panel', '') as TabId;
      panelEl.classList.toggle('hidden', panelId !== this.activeTab);
    });
  }

  /**
   * Update badge count for a tab
   */
  public setBadge(tabId: TabId, count: number): void {
    const badge = this.container?.querySelector(`#badge-${tabId}`) as HTMLElement;
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count.toString();
      badge.classList.toggle('hidden', count === 0);
    }
  }

  /**
   * Get all available tabs
   */
  public getTabs(): Tab[] {
    return [...TABS];
  }
}
