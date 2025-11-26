/**
 * VAD (Voice Activity Detection) Module (PATH K - Feed C)
 *
 * Detects emergency phrases in transcript stream.
 * Triggers alerts to overlay with critical severity.
 */

export type EmergencySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface EmergencyAlert {
  phrase: string;
  severity: EmergencySeverity;
  timestamp: number;
  context: string;
}

export interface VADConfig {
  onEmergency: (alert: EmergencyAlert) => void;
}

// Emergency phrase patterns with severity levels
const EMERGENCY_PATTERNS: Array<{ pattern: RegExp; severity: EmergencySeverity }> = [
  // Critical - immediate life threat
  { pattern: /\b(code blue|cardiac arrest|not breathing|no pulse|anaphylaxis)\b/i, severity: 'critical' },
  { pattern: /\b(stroke|mi|heart attack|seizure|hemorrhage)\b/i, severity: 'critical' },
  { pattern: /\b(unresponsive|unconscious|collapsed)\b/i, severity: 'critical' },

  // High - urgent attention needed
  { pattern: /\b(chest pain|difficulty breathing|severe pain|acute)\b/i, severity: 'high' },
  { pattern: /\b(allergic reaction|blood pressure.*(?:high|low|drop))\b/i, severity: 'high' },
  { pattern: /\b(fever.*high|temp.*(?:104|105|106))\b/i, severity: 'high' },

  // Medium - notable concern
  { pattern: /\b(dizzy|lightheaded|nausea|vomit)\b/i, severity: 'medium' },
  { pattern: /\b(fall|injury|trauma|wound)\b/i, severity: 'medium' },
  { pattern: /\b(confused|disoriented|altered)\b/i, severity: 'medium' },

  // Low - monitor
  { pattern: /\b(pain|discomfort|concern|worried)\b/i, severity: 'low' }
];

export class VAD {
  private config: VADConfig;
  private recentAlerts: Map<string, number> = new Map();
  private alertCooldown = 30000; // 30 seconds between same alerts

  constructor(config: VADConfig) {
    this.config = config;
  }

  /**
   * Analyze transcript text for emergency phrases
   */
  analyzeTranscript(text: string, context?: string): EmergencyAlert | null {
    const normalizedText = text.toLowerCase();

    for (const { pattern, severity } of EMERGENCY_PATTERNS) {
      const match = normalizedText.match(pattern);
      if (match) {
        const phrase = match[0];

        // Check cooldown
        const lastAlert = this.recentAlerts.get(phrase);
        if (lastAlert && Date.now() - lastAlert < this.alertCooldown) {
          continue;
        }

        // Record alert time
        this.recentAlerts.set(phrase, Date.now());

        const alert: EmergencyAlert = {
          phrase,
          severity,
          timestamp: Date.now(),
          context: context || text.substring(0, 100)
        };

        // Only emit for high/critical in production
        if (severity === 'critical' || severity === 'high') {
          this.config.onEmergency(alert);
        }

        return alert;
      }
    }

    return null;
  }

  /**
   * Clear cooldown cache
   */
  clearCooldowns(): void {
    this.recentAlerts.clear();
  }
}

/**
 * Create emergency broadcast message for Feed C
 */
export function createEmergencyBroadcast(alert: EmergencyAlert): object {
  return {
    type: 'alert',
    feed: 'C',
    emergency: {
      phrase: alert.phrase,
      severity: alert.severity,
      timestamp: alert.timestamp,
      context: alert.context
    }
  };
}
