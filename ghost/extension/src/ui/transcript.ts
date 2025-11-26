/**
 * Transcript View Component
 *
 * Displays real-time transcription with speaker diarization.
 * Shows interim and final transcript lines with timestamps.
 */

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export class TranscriptView {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private linesContainer: HTMLElement | null = null;
  private lines: TranscriptLine[] = [];
  private autoScroll: boolean = true;

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public updateLines(lines: TranscriptLine[]): void {
    this.lines = lines;
    this.renderLines();
  }

  public addLine(line: TranscriptLine): void {
    const existingIndex = this.lines.findIndex(l => l.id === line.id);
    if (existingIndex >= 0) {
      this.lines[existingIndex] = line;
    } else {
      this.lines.push(line);
    }
    this.renderLines();
  }

  public clear(): void {
    this.lines = [];
    if (this.linesContainer) {
      this.linesContainer.innerHTML = '';
      this.showEmptyState();
    }
  }

  private render(): void {
    if (!this.container) return;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.container.appendChild(styles);

    // Create transcript wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'transcript-wrapper';

    // Header with controls
    const header = document.createElement('div');
    header.className = 'transcript-header';
    header.innerHTML = `
      <span class="transcript-title">Live Transcript</span>
      <div class="transcript-controls">
        <label class="auto-scroll-toggle">
          <input type="checkbox" checked />
          <span>Auto-scroll</span>
        </label>
      </div>
    `;

    const autoScrollCheckbox = header.querySelector('input');
    autoScrollCheckbox?.addEventListener('change', (e) => {
      this.autoScroll = (e.target as HTMLInputElement).checked;
    });

    // Lines container
    this.linesContainer = document.createElement('div');
    this.linesContainer.className = 'transcript-lines';

    wrapper.appendChild(header);
    wrapper.appendChild(this.linesContainer);
    this.container.appendChild(wrapper);

    this.showEmptyState();
  }

  private renderLines(): void {
    if (!this.linesContainer) return;

    // Clear existing content
    this.linesContainer.innerHTML = '';

    if (this.lines.length === 0) {
      this.showEmptyState();
      return;
    }

    // Group consecutive lines by speaker
    const groupedLines = this.groupBySpeaker(this.lines);

    groupedLines.forEach(group => {
      const groupEl = document.createElement('div');
      groupEl.className = 'speaker-group';

      // Speaker header
      const speakerHeader = document.createElement('div');
      speakerHeader.className = 'speaker-header';
      speakerHeader.innerHTML = `
        <span class="speaker-badge" data-speaker="${group.speaker}">
          ${this.getSpeakerLabel(group.speaker)}
        </span>
        <span class="timestamp">${this.formatTime(group.lines[0].timestamp)}</span>
      `;
      groupEl.appendChild(speakerHeader);

      // Lines
      group.lines.forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = `transcript-line ${line.isFinal ? 'final' : 'interim'}`;
        lineEl.dataset.lineId = line.id;
        lineEl.textContent = line.text;
        groupEl.appendChild(lineEl);
      });

      this.linesContainer!.appendChild(groupEl);
    });

    // Auto-scroll to bottom
    if (this.autoScroll) {
      this.linesContainer.scrollTop = this.linesContainer.scrollHeight;
    }
  }

  private groupBySpeaker(lines: TranscriptLine[]): { speaker: string; lines: TranscriptLine[] }[] {
    const groups: { speaker: string; lines: TranscriptLine[] }[] = [];
    let currentGroup: { speaker: string; lines: TranscriptLine[] } | null = null;

    lines.forEach(line => {
      if (!currentGroup || currentGroup.speaker !== line.speaker) {
        currentGroup = { speaker: line.speaker, lines: [] };
        groups.push(currentGroup);
      }
      currentGroup.lines.push(line);
    });

    return groups;
  }

  private getSpeakerLabel(speaker: string): string {
    // Map speaker IDs to friendly labels
    const speakerMap: Record<string, string> = {
      '0': 'Provider',
      '1': 'Patient',
      'provider': 'Provider',
      'patient': 'Patient',
      'unknown': 'Speaker'
    };

    return speakerMap[speaker.toLowerCase()] || `Speaker ${speaker}`;
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  private showEmptyState(): void {
    if (!this.linesContainer) return;

    this.linesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎙️</div>
        <p>No transcript yet</p>
        <p class="empty-hint">Start recording to see real-time transcription</p>
      </div>
    `;
  }

  private getStyles(): string {
    return `
      .transcript-wrapper {
        display: flex;
        flex-direction: column;
        height: 280px;
      }

      .transcript-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid #2d2d44;
        margin-bottom: 8px;
      }

      .transcript-title {
        font-size: 12px;
        font-weight: 600;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .auto-scroll-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #666;
        cursor: pointer;
      }

      .auto-scroll-toggle input {
        width: 14px;
        height: 14px;
        accent-color: #e63946;
      }

      .transcript-lines {
        flex: 1;
        overflow-y: auto;
        padding-right: 4px;
      }

      .speaker-group {
        margin-bottom: 16px;
      }

      .speaker-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      .speaker-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 10px;
        text-transform: uppercase;
      }

      .speaker-badge[data-speaker="0"],
      .speaker-badge[data-speaker="provider"] {
        background: rgba(76, 175, 80, 0.2);
        color: #4caf50;
      }

      .speaker-badge[data-speaker="1"],
      .speaker-badge[data-speaker="patient"] {
        background: rgba(33, 150, 243, 0.2);
        color: #2196f3;
      }

      .timestamp {
        font-size: 10px;
        color: #555;
      }

      .transcript-line {
        font-size: 13px;
        line-height: 1.5;
        color: #ddd;
        padding: 2px 0;
      }

      .transcript-line.interim {
        color: #888;
        font-style: italic;
      }

      .transcript-line.final {
        color: #eee;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #555;
        text-align: center;
      }

      .empty-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
      }

      .empty-state p {
        margin: 4px 0;
        font-size: 14px;
      }

      .empty-hint {
        font-size: 12px !important;
        color: #444;
      }
    `;
  }
}
