/**
 * Autopilot - DOM Coverage Scoring and Readiness Assessment
 *
 * Analyzes DOM fields and transcript to calculate:
 * - Coverage score (0-100%)
 * - Readiness status (red/yellow/green)
 * - Missing field suggestions
 */

import { DomField, TabManager } from './tab-manager.js';
import { TranscriptData } from './command-router.js';

export type AutopilotStatus = 'red' | 'yellow' | 'green';

export interface AutopilotReport {
  tabId: string;
  status: AutopilotStatus;
  score: number;
  coveredFields: string[];
  missingFields: string[];
  suggestions: string[];
  timestamp: number;
}

export interface FieldWeight {
  name: string;
  weight: number;
  required: boolean;
  patterns: string[];
}

export class Autopilot {
  private tabManager: TabManager;
  private transcriptData: Map<string, TranscriptData> = new Map();

  // Field weights for scoring (higher weight = more important)
  private readonly fieldWeights: FieldWeight[] = [
    { name: 'chief_complaint', weight: 20, required: true, patterns: ['chief complaint', 'cc', 'reason for visit'] },
    { name: 'hpi', weight: 20, required: true, patterns: ['hpi', 'history of present illness', 'present illness'] },
    { name: 'assessment', weight: 15, required: true, patterns: ['assessment', 'diagnosis', 'impression', 'dx'] },
    { name: 'plan', weight: 15, required: true, patterns: ['plan', 'treatment', 'treatment plan'] },
    { name: 'vitals', weight: 10, required: false, patterns: ['vitals', 'vital signs', 'bp', 'temperature'] },
    { name: 'medications', weight: 8, required: false, patterns: ['medications', 'meds', 'current medications'] },
    { name: 'allergies', weight: 7, required: false, patterns: ['allergies', 'allergy', 'drug allergies'] },
    { name: 'review_of_systems', weight: 5, required: false, patterns: ['ros', 'review of systems'] }
  ];

  constructor(tabManager: TabManager) {
    this.tabManager = tabManager;
  }

  /**
   * Update transcript data for a tab
   */
  updateTranscript(tabId: string, data: TranscriptData): void {
    this.transcriptData.set(tabId, data);
  }

  /**
   * Calculate coverage report for a tab
   */
  calculateCoverage(tabId: string): AutopilotReport {
    const tab = this.tabManager.getTab(tabId);
    const transcript = this.transcriptData.get(tabId);

    if (!tab || !tab.domMap) {
      return this.emptyReport(tabId);
    }

    const domFields = tab.domMap;
    const text = transcript?.fullText?.toLowerCase() || '';

    // Match DOM fields to known field types
    const fieldCoverage = this.analyzeFieldCoverage(domFields, text);

    // Calculate weighted score
    const { score, coveredFields, missingFields } = this.calculateScore(fieldCoverage);

    // Generate suggestions
    const suggestions = this.generateSuggestions(missingFields, fieldCoverage);

    // Determine status
    const status = this.getStatus(score, fieldCoverage);

    return {
      tabId,
      status,
      score: Math.round(score),
      coveredFields,
      missingFields,
      suggestions,
      timestamp: Date.now()
    };
  }

  /**
   * Analyze which fields have coverage in the transcript
   */
  private analyzeFieldCoverage(
    domFields: DomField[],
    transcriptText: string
  ): Map<string, { field: DomField | null; hasCoverage: boolean; confidence: number }> {
    const coverage = new Map<string, { field: DomField | null; hasCoverage: boolean; confidence: number }>();

    // Initialize all known fields
    for (const fieldWeight of this.fieldWeights) {
      coverage.set(fieldWeight.name, {
        field: null,
        hasCoverage: false,
        confidence: 0
      });
    }

    // Match DOM fields to known field types
    for (const domField of domFields) {
      const normalizedLabel = (domField.label || domField.name).toLowerCase();

      for (const fieldWeight of this.fieldWeights) {
        const matches = fieldWeight.patterns.some(p => normalizedLabel.includes(p));
        if (matches) {
          const existing = coverage.get(fieldWeight.name)!;

          // Check if transcript has content for this field
          const hasCoverage = this.hasTranscriptCoverage(fieldWeight.patterns, transcriptText);
          const confidence = hasCoverage ? this.calculateConfidence(fieldWeight.patterns, transcriptText) : 0;

          coverage.set(fieldWeight.name, {
            field: domField,
            hasCoverage,
            confidence
          });
          break;
        }
      }
    }

    return coverage;
  }

  /**
   * Check if transcript has coverage for a field
   */
  private hasTranscriptCoverage(patterns: string[], text: string): boolean {
    if (!text) return false;

    // Check for explicit mentions
    for (const pattern of patterns) {
      if (text.includes(pattern)) return true;
    }

    // Check for implied content (e.g., symptoms for chief complaint)
    const impliedPatterns: Record<string, RegExp[]> = {
      'chief complaint': [/patient (?:presents|presented|came in) (?:with|for)/i, /(?:complaining of|reports?)/i],
      'hpi': [/(?:started|began|noticed) (?:\d+ )?(?:days?|weeks?|months?) ago/i, /(?:history of|previously)/i],
      'assessment': [/(?:likely|appears to be|consistent with|suggestive of)/i],
      'plan': [/(?:will|should|recommend|prescribe|order)/i]
    };

    for (const pattern of patterns) {
      const implied = impliedPatterns[pattern];
      if (implied) {
        for (const regex of implied) {
          if (regex.test(text)) return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculate confidence score for field coverage
   */
  private calculateConfidence(patterns: string[], text: string): number {
    let confidence = 0;

    for (const pattern of patterns) {
      const idx = text.indexOf(pattern);
      if (idx >= 0) {
        // Find content after the pattern
        const afterPattern = text.substring(idx + pattern.length, idx + pattern.length + 100);
        const hasContent = afterPattern.trim().length > 10;
        confidence = hasContent ? 0.8 : 0.5;
        break;
      }
    }

    return confidence;
  }

  /**
   * Calculate weighted coverage score
   */
  private calculateScore(
    fieldCoverage: Map<string, { field: DomField | null; hasCoverage: boolean; confidence: number }>
  ): { score: number; coveredFields: string[]; missingFields: string[] } {
    let totalWeight = 0;
    let coveredWeight = 0;
    const coveredFields: string[] = [];
    const missingFields: string[] = [];

    for (const fieldWeight of this.fieldWeights) {
      const coverage = fieldCoverage.get(fieldWeight.name);

      // Only count fields that exist in the DOM
      if (coverage?.field) {
        totalWeight += fieldWeight.weight;

        if (coverage.hasCoverage) {
          coveredWeight += fieldWeight.weight * coverage.confidence;
          coveredFields.push(fieldWeight.name);
        } else {
          missingFields.push(fieldWeight.name);
        }
      } else if (fieldWeight.required) {
        // Required field not found in DOM - note it
        missingFields.push(`${fieldWeight.name} (field not found)`);
      }
    }

    const score = totalWeight > 0 ? (coveredWeight / totalWeight) * 100 : 0;

    return { score, coveredFields, missingFields };
  }

  /**
   * Generate suggestions for missing fields
   */
  private generateSuggestions(
    missingFields: string[],
    fieldCoverage: Map<string, { field: DomField | null; hasCoverage: boolean; confidence: number }>
  ): string[] {
    const suggestions: string[] = [];

    for (const fieldName of missingFields) {
      const cleanName = fieldName.replace(' (field not found)', '');
      const fieldWeight = this.fieldWeights.find(f => f.name === cleanName);

      if (fieldWeight?.required) {
        suggestions.push(`Document ${this.formatFieldName(cleanName)} in conversation`);
      }
    }

    // Add general suggestions
    if (suggestions.length === 0 && missingFields.length > 0) {
      suggestions.push('Continue documenting to improve coverage');
    }

    // Limit to 5 suggestions
    return suggestions.slice(0, 5);
  }

  /**
   * Format field name for display
   */
  private formatFieldName(name: string): string {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Determine status based on score and required field coverage
   */
  private getStatus(
    score: number,
    fieldCoverage: Map<string, { field: DomField | null; hasCoverage: boolean; confidence: number }>
  ): AutopilotStatus {
    // Check if all required fields have coverage
    const requiredFields = this.fieldWeights.filter(f => f.required);
    const allRequiredCovered = requiredFields.every(f => {
      const coverage = fieldCoverage.get(f.name);
      return !coverage?.field || coverage.hasCoverage; // Covered or field not in DOM
    });

    if (score >= 80 && allRequiredCovered) {
      return 'green';
    } else if (score >= 50 || allRequiredCovered) {
      return 'yellow';
    } else {
      return 'red';
    }
  }

  /**
   * Create empty report for missing data
   */
  private emptyReport(tabId: string): AutopilotReport {
    return {
      tabId,
      status: 'red',
      score: 0,
      coveredFields: [],
      missingFields: ['No DOM fields scanned'],
      suggestions: ['Scan the EHR page to detect form fields'],
      timestamp: Date.now()
    };
  }

  /**
   * Get quick status for a tab without full report
   */
  getQuickStatus(tabId: string): AutopilotStatus {
    const report = this.calculateCoverage(tabId);
    return report.status;
  }
}
