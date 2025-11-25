/**
 * Status Pills Component
 *
 * Displays connection status, recording state, and patient info
 * as compact pill-shaped badges in the header.
 */

import { PatientInfo } from '../overlay';

export interface PillsState {
  isConnected: boolean;
  isRecording: boolean;
  patientInfo: PatientInfo | null;
}

export class StatusPills {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private state: PillsState = {
    isConnected: false,
    isRecording: false,
    patientInfo: null
  };

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(state: Partial<PillsState>): void {
    this.state = { ...this.state, ...state };
    this.updatePills();
  }

  private render(): void {
    if (!this.container) return;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();

    const pillsWrapper = document.createElement('div');
    pillsWrapper.className = 'pills-wrapper';
    pillsWrapper.innerHTML = `
      <span class="status-pill connection-pill" data-status="disconnected">
        <span class="pill-dot"></span>
        <span class="pill-text">Offline</span>
      </span>
      <span class="status-pill recording-pill hidden">
        <span class="pill-dot recording"></span>
        <span class="pill-text">REC</span>
      </span>
      <span class="status-pill patient-pill hidden" title="">
        <span class="pill-icon">👤</span>
        <span class="pill-text patient-name"></span>
      </span>
    `;

    this.container.appendChild(styles);
    this.container.appendChild(pillsWrapper);

    this.updatePills();
  }

  private updatePills(): void {
    if (!this.container) return;

    // Update connection pill
    const connectionPill = this.container.querySelector('.connection-pill');
    if (connectionPill) {
      connectionPill.setAttribute('data-status', this.state.isConnected ? 'connected' : 'disconnected');
      const text = connectionPill.querySelector('.pill-text');
      if (text) {
        text.textContent = this.state.isConnected ? 'Online' : 'Offline';
      }
    }

    // Update recording pill
    const recordingPill = this.container.querySelector('.recording-pill');
    if (recordingPill) {
      recordingPill.classList.toggle('hidden', !this.state.isRecording);
    }

    // Update patient pill
    const patientPill = this.container.querySelector('.patient-pill') as HTMLElement;
    if (patientPill) {
      if (this.state.patientInfo?.name) {
        patientPill.classList.remove('hidden');
        const nameEl = patientPill.querySelector('.patient-name');
        if (nameEl) {
          nameEl.textContent = this.truncateName(this.state.patientInfo.name);
        }
        patientPill.title = this.getPatientTooltip();
      } else {
        patientPill.classList.add('hidden');
      }
    }
  }

  private truncateName(name: string): string {
    const maxLength = 12;
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 1) + '…';
  }

  private getPatientTooltip(): string {
    const info = this.state.patientInfo;
    if (!info) return '';

    let tooltip = info.name;
    if (info.mrn) tooltip += `\nMRN: ${info.mrn}`;
    if (info.dob) tooltip += `\nDOB: ${info.dob}`;
    return tooltip;
  }

  private getStyles(): string {
    return `
      .pills-wrapper {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        background: rgba(0, 0, 0, 0.3);
        color: rgba(255, 255, 255, 0.8);
      }

      .status-pill.hidden {
        display: none;
      }

      .pill-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .pill-dot.recording {
        animation: blink 1s infinite;
      }

      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0.3; }
      }

      .pill-icon {
        font-size: 10px;
      }

      /* Connection status colors */
      .connection-pill[data-status="connected"] {
        background: rgba(76, 175, 80, 0.2);
        color: #4caf50;
      }

      .connection-pill[data-status="disconnected"] {
        background: rgba(244, 67, 54, 0.2);
        color: #f44336;
      }

      /* Recording status */
      .recording-pill {
        background: rgba(244, 67, 54, 0.3);
        color: #ff5252;
      }

      /* Patient pill */
      .patient-pill {
        background: rgba(33, 150, 243, 0.2);
        color: #64b5f6;
        cursor: help;
      }
    `;
  }
}
