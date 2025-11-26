/**
 * Voice Concierge Module (PATH L - Feed B)
 *
 * Detects voice commands from transcript stream.
 * Commands: scroll down, fill this, map page, undo, next field, etc.
 */

export type VoiceCommand =
  | 'scroll_down'
  | 'scroll_up'
  | 'fill_this'
  | 'map_page'
  | 'undo'
  | 'next_field'
  | 'prev_field'
  | 'submit'
  | 'cancel'
  | 'stop'
  | 'start'
  | 'assist_help'
  | 'assist_consent';

export interface DetectedCommand {
  command: VoiceCommand;
  confidence: number;
  rawPhrase: string;
  timestamp: number;
}

export interface VoiceConciergeConfig {
  onCommand: (cmd: DetectedCommand) => void;
}

// Command patterns with their mappings
const COMMAND_PATTERNS: Array<{ patterns: RegExp[]; command: VoiceCommand }> = [
  {
    patterns: [/\bscroll\s*down\b/i, /\bgo\s*down\b/i, /\bpage\s*down\b/i],
    command: 'scroll_down'
  },
  {
    patterns: [/\bscroll\s*up\b/i, /\bgo\s*up\b/i, /\bpage\s*up\b/i],
    command: 'scroll_up'
  },
  {
    patterns: [/\bfill\s*(?:this|it|field)?\b/i, /\bauto\s*fill\b/i, /\bpopulate\b/i],
    command: 'fill_this'
  },
  {
    patterns: [/\bmap\s*(?:page|this)?\b/i, /\bscan\s*(?:page|fields)?\b/i, /\bdetect\s*fields\b/i],
    command: 'map_page'
  },
  {
    patterns: [/\bundo\b/i, /\brevert\b/i, /\bgo\s*back\b/i],
    command: 'undo'
  },
  {
    patterns: [/\bnext\s*(?:field|input)?\b/i, /\btab\b/i, /\bforward\b/i],
    command: 'next_field'
  },
  {
    patterns: [/\bprev(?:ious)?\s*(?:field|input)?\b/i, /\bback\b/i, /\bshift\s*tab\b/i],
    command: 'prev_field'
  },
  {
    patterns: [/\bsubmit\b/i, /\bsend\b/i, /\bfinish\b/i, /\bdone\b/i],
    command: 'submit'
  },
  {
    patterns: [/\bcancel\b/i, /\babort\b/i, /\bstop\s*that\b/i],
    command: 'cancel'
  },
  {
    patterns: [/\bstop\s*(?:recording|listening)?\b/i, /\bpause\b/i],
    command: 'stop'
  },
  {
    patterns: [/\bstart\s*(?:recording|listening)?\b/i, /\bresume\b/i, /\bbegin\b/i],
    command: 'start'
  },
  // "Assist" wake word commands
  {
    patterns: [
      /\bassist[,.]?\s*(?:can you |could you |please )?help/i,
      /\bassist[,.]?\s*(?:what is|what's|tell me)/i,
      /\bassist[,.]?\s*(?:i need|i want)/i
    ],
    command: 'assist_help'
  },
  {
    patterns: [
      /\bassist[,.]?\s*consent\s*(?:granted|given|obtained)/i,
      /\bassist[,.]?\s*(?:patient\s*)?consent(?:ed)?/i,
      /\bconsent\s*(?:granted|given|obtained)/i
    ],
    command: 'assist_consent'
  }
];

export class VoiceConcierge {
  private config: VoiceConciergeConfig;
  private lastCommandTime = 0;
  private commandCooldown = 2000; // 2 seconds between commands
  private enabled = true;

  constructor(config: VoiceConciergeConfig) {
    this.config = config;
  }

  /**
   * Analyze transcript text for voice commands
   */
  analyzeTranscript(text: string): DetectedCommand | null {
    if (!this.enabled) return null;

    const now = Date.now();
    if (now - this.lastCommandTime < this.commandCooldown) {
      return null;
    }

    const normalizedText = text.toLowerCase().trim();

    for (const { patterns, command } of COMMAND_PATTERNS) {
      for (const pattern of patterns) {
        const match = normalizedText.match(pattern);
        if (match) {
          this.lastCommandTime = now;

          const detected: DetectedCommand = {
            command,
            confidence: 0.9,
            rawPhrase: match[0],
            timestamp: now
          };

          this.config.onCommand(detected);
          return detected;
        }
      }
    }

    return null;
  }

  /**
   * Enable/disable voice command detection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if voice commands are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Reset cooldown
   */
  resetCooldown(): void {
    this.lastCommandTime = 0;
  }
}

/**
 * Create voice command broadcast message for Feed B
 */
export function createCommandBroadcast(cmd: DetectedCommand): object {
  return {
    kind: 'voice_command',
    feed: 'B',
    command: {
      action: cmd.command,
      confidence: cmd.confidence,
      phrase: cmd.rawPhrase,
      timestamp: cmd.timestamp
    }
  };
}

/**
 * Map voice command to action for UI
 */
export function getCommandUIAction(command: VoiceCommand): {
  icon: string;
  label: string;
  highlight: boolean;
} {
  const actions: Record<VoiceCommand, { icon: string; label: string; highlight: boolean }> = {
    scroll_down: { icon: '↓', label: 'Scroll Down', highlight: false },
    scroll_up: { icon: '↑', label: 'Scroll Up', highlight: false },
    fill_this: { icon: '✏️', label: 'Auto Fill', highlight: true },
    map_page: { icon: '🗺️', label: 'Map Page', highlight: true },
    undo: { icon: '↩️', label: 'Undo', highlight: false },
    next_field: { icon: '→', label: 'Next Field', highlight: false },
    prev_field: { icon: '←', label: 'Prev Field', highlight: false },
    submit: { icon: '✓', label: 'Submit', highlight: true },
    cancel: { icon: '✗', label: 'Cancel', highlight: false },
    stop: { icon: '⏹', label: 'Stop', highlight: false },
    start: { icon: '▶', label: 'Start', highlight: true },
    assist_help: { icon: '💬', label: 'Assist', highlight: true },
    assist_consent: { icon: '✓', label: 'Consent', highlight: true }
  };

  return actions[command];
}
