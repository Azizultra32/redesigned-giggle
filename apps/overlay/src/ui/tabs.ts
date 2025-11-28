/**
 * Tabs Component
 *
 * Tab navigation for switching between overlay panels:
 * - Summary, SOAP, Transcript, Tasks, Patient, Debug
 */

export type TabId = 'summary' | 'soap' | 'transcript' | 'tasks' | 'patient' | 'debug';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: 'summary', label: 'Summary', icon: '📋' },
  { id: 'soap', label: 'SOAP', icon: '📄' },
  { id: 'transcript', label: 'Transcript', icon: '📝' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'patient', label: 'Patient', icon: '👤' },
  { id: 'debug', label: 'Debug', icon: '🔧' }
];

export class TabsComponent {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private activeTab: TabId = 'transcript';
  private onTabChange: (tab: TabId) => void;

  constructor(shadowRoot: ShadowRoot, onTabChange: (tab: TabId) => void) {
    this.shadowRoot = shadowRoot;
    this.onTabChange = onTabChange;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public setActiveTab(tabId: TabId): void {
    this.activeTab = tabId;
    this.updateActiveState();
  }

  private render(): void {
    if (!this.container) return;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
      .tabs-container {
        display: flex;
        padding: 0 8px;
      }

      .tab-button {
        flex: 1;
        padding: 10px 12px;
        background: transparent;
        border: none;
        color: #888;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border-bottom: 2px solid transparent;
      }

      .tab-button:hover {
        color: #ccc;
        background: rgba(255, 255, 255, 0.05);
      }

      .tab-button.active {
        color: #e63946;
        border-bottom-color: #e63946;
      }

      .tab-icon {
        font-size: 14px;
      }
    `;

    // Create tabs
    const tabsWrapper = document.createElement('div');
    tabsWrapper.className = 'tabs-container';

    TABS.forEach(tab => {
      const button = document.createElement('button');
      button.className = `tab-button ${tab.id === this.activeTab ? 'active' : ''}`;
      button.dataset.tab = tab.id;
      button.innerHTML = `
        <span class="tab-icon">${tab.icon}</span>
        <span>${tab.label}</span>
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
}
