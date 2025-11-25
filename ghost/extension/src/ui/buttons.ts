/**
 * Control Buttons Component
 *
 * Recording controls and action buttons for the overlay.
 * Manages start/stop recording, clear transcript, and field mapping.
 */

export interface ButtonState {
  isRecording: boolean;
  isConnected: boolean;
}

export type ControlAction = 'start' | 'stop' | 'clear' | 'minimize' | 'map';

export class ControlButtons {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private state: ButtonState = { isRecording: false, isConnected: false };
  private onAction: (action: ControlAction) => void;

  constructor(shadowRoot: ShadowRoot, onAction: (action: ControlAction) => void) {
    this.shadowRoot = shadowRoot;
    this.onAction = onAction;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(state: Partial<ButtonState>): void {
    this.state = { ...this.state, ...state };
    this.updateButtonStates();
  }

  private render(): void {
    if (!this.container) return;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.container.appendChild(styles);

    // Create button container
    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'controls-wrapper';

    buttonWrapper.innerHTML = `
      <div class="primary-controls">
        <button class="control-btn record-btn" data-action="start" title="Start Recording">
          <span class="btn-icon">⏺️</span>
          <span class="btn-label">Record</span>
        </button>
        <button class="control-btn stop-btn hidden" data-action="stop" title="Stop Recording">
          <span class="btn-icon">⏹️</span>
          <span class="btn-label">Stop</span>
        </button>
      </div>
      <div class="secondary-controls">
        <button class="control-btn secondary" data-action="map" title="Map Fields">
          <span class="btn-icon">🎯</span>
        </button>
        <button class="control-btn secondary" data-action="clear" title="Clear Transcript">
          <span class="btn-icon">🗑️</span>
        </button>
      </div>
    `;

    // Add event listeners
    const buttons = buttonWrapper.querySelectorAll('.control-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action as ControlAction;
        this.handleClick(action);
      });
    });

    this.container.appendChild(buttonWrapper);
  }

  private handleClick(action: ControlAction): void {
    // Handle recording toggle internally
    if (action === 'start') {
      this.state.isRecording = true;
      this.updateButtonStates();
    } else if (action === 'stop') {
      this.state.isRecording = false;
      this.updateButtonStates();
    }

    this.onAction(action);
  }

  private updateButtonStates(): void {
    if (!this.container) return;

    const recordBtn = this.container.querySelector('.record-btn') as HTMLElement;
    const stopBtn = this.container.querySelector('.stop-btn') as HTMLElement;

    if (recordBtn && stopBtn) {
      if (this.state.isRecording) {
        recordBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
      } else {
        recordBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
      }

      // Disable controls if not connected
      const allButtons = this.container.querySelectorAll('.control-btn');
      allButtons.forEach(btn => {
        (btn as HTMLButtonElement).disabled = !this.state.isConnected;
      });
    }
  }

  private getStyles(): string {
    return `
      .controls-wrapper {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .primary-controls {
        flex: 1;
      }

      .secondary-controls {
        display: flex;
        gap: 8px;
      }

      .control-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 20px;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .control-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .control-btn.hidden {
        display: none;
      }

      .record-btn {
        background: linear-gradient(135deg, #e63946 0%, #c62828 100%);
        color: white;
        width: 100%;
      }

      .record-btn:hover:not(:disabled) {
        background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(230, 57, 70, 0.3);
      }

      .record-btn:active:not(:disabled) {
        transform: translateY(0);
      }

      .stop-btn {
        background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
        color: white;
        width: 100%;
        animation: pulse 1.5s infinite;
      }

      .stop-btn:hover:not(:disabled) {
        background: linear-gradient(135deg, #ffa726 0%, #fb8c00 100%);
        animation: none;
      }

      @keyframes pulse {
        0%, 100% {
          box-shadow: 0 0 0 0 rgba(255, 152, 0, 0.4);
        }
        50% {
          box-shadow: 0 0 0 8px rgba(255, 152, 0, 0);
        }
      }

      .control-btn.secondary {
        background: #2d2d44;
        color: #aaa;
        padding: 10px 14px;
      }

      .control-btn.secondary:hover:not(:disabled) {
        background: #3d3d54;
        color: #fff;
      }

      .btn-icon {
        font-size: 16px;
      }

      .btn-label {
        font-size: 13px;
      }
    `;
  }
}
