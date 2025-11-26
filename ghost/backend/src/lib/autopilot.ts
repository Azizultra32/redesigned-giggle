/**
 * Autopilot Module - DOM coverage scoring and readiness detection
 *
 * Monitors form completion progress and signals when documentation is ready.
 * Uses a traffic light system: red (not ready) → yellow (partial) → green (ready)
 */

import { DomMap, DomField } from '../types/index.js';

export type AutopilotStatus = 'red' | 'yellow' | 'green';

export interface FieldScore {
  selector: string;
  label: string;
  fieldType: string;
  required: boolean;
  filled: boolean;
  quality: number; // 0-100
}

export interface CoverageReport {
  status: AutopilotStatus;
  score: number; // 0-100
  filled: number;
  total: number;
  required: {
    filled: number;
    total: number;
  };
  optional: {
    filled: number;
    total: number;
  };
  fields: FieldScore[];
  suggestions: string[];
  timestamp: number;
}

// Required clinical fields (must be filled for green status)
const REQUIRED_FIELDS = [
  'chief_complaint',
  'hpi',
  'assessment',
  'plan'
];

// Important but optional fields (contribute to score)
const IMPORTANT_FIELDS = [
  'ros',
  'physical_exam',
  'medications',
  'allergies',
  'vitals'
];

// Minimum content length for field to be considered "filled"
const MIN_CONTENT_LENGTH: Record<string, number> = {
  chief_complaint: 10,
  hpi: 50,
  ros: 20,
  physical_exam: 30,
  assessment: 20,
  plan: 30,
  medications: 5,
  allergies: 3,
  vitals: 10,
  default: 5
};

// Quality thresholds
const QUALITY_THRESHOLDS = {
  poor: 25,
  fair: 50,
  good: 75,
  excellent: 90
};

export class Autopilot {
  // Store coverage history per tab
  private coverageHistory: Map<string, CoverageReport[]> = new Map();
  private maxHistorySize = 100;

  /**
   * Calculate coverage for a DOM map
   */
  calculateCoverage(tabId: string, domMap: DomMap): CoverageReport {
    const fields = domMap.fields || [];
    const fieldScores: FieldScore[] = [];

    let totalRequired = 0;
    let filledRequired = 0;
    let totalOptional = 0;
    let filledOptional = 0;
    let totalScore = 0;

    for (const field of fields) {
      if (field.type !== 'input' && field.type !== 'textarea') continue;

      const fieldType = this.classifyField(field);
      const isRequired = REQUIRED_FIELDS.includes(fieldType);
      const isImportant = IMPORTANT_FIELDS.includes(fieldType);

      if (!isRequired && !isImportant) continue; // Skip unclassified fields

      const { filled, quality } = this.evaluateField(field, fieldType);

      fieldScores.push({
        selector: field.selector,
        label: field.label || field.name || 'Unknown',
        fieldType,
        required: isRequired,
        filled,
        quality
      });

      if (isRequired) {
        totalRequired++;
        if (filled) filledRequired++;
        totalScore += quality * 2; // Required fields count double
      } else {
        totalOptional++;
        if (filled) filledOptional++;
        totalScore += quality;
      }
    }

    // Calculate overall score (0-100)
    const maxScore = (totalRequired * 2 + totalOptional) * 100;
    const score = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    // Determine status based on coverage
    const status = this.determineStatus(filledRequired, totalRequired, score);

    // Generate suggestions
    const suggestions = this.generateSuggestions(fieldScores, status);

    const report: CoverageReport = {
      status,
      score,
      filled: filledRequired + filledOptional,
      total: totalRequired + totalOptional,
      required: {
        filled: filledRequired,
        total: totalRequired
      },
      optional: {
        filled: filledOptional,
        total: totalOptional
      },
      fields: fieldScores,
      suggestions,
      timestamp: Date.now()
    };

    // Store in history
    this.recordCoverage(tabId, report);

    return report;
  }

  /**
   * Classify field into clinical category based on label/name
   */
  private classifyField(field: DomField): string {
    const label = (field.label || '').toLowerCase();
    const name = (field.name || '').toLowerCase();
    const combined = `${label} ${name}`;

    const patterns: Record<string, RegExp[]> = {
      chief_complaint: [/chief\s*complaint/i, /cc\b/i, /reason\s*for\s*visit/i, /presenting/i],
      hpi: [/history\s*of\s*present/i, /hpi\b/i, /history\s*present/i],
      ros: [/review\s*of\s*systems/i, /ros\b/i, /review\s*systems/i],
      physical_exam: [/physical\s*exam/i, /\bpe\b/i, /examination/i, /exam\s*findings/i],
      assessment: [/assessment/i, /diagnosis/i, /impression/i, /\bdx\b/i],
      plan: [/\bplan\b/i, /treatment/i, /recommendation/i, /management/i],
      medications: [/medication/i, /\brx\b/i, /prescription/i, /drug/i, /med\s*list/i],
      allergies: [/allerg/i, /adverse\s*reaction/i],
      vitals: [/vital/i, /\bbp\b/i, /blood\s*pressure/i, /temp/i, /pulse/i, /\bhr\b/i]
    };

    for (const [type, regexes] of Object.entries(patterns)) {
      if (regexes.some(r => r.test(combined))) {
        return type;
      }
    }

    return 'other';
  }

  /**
   * Evaluate if field is filled and its quality
   */
  private evaluateField(field: DomField, fieldType: string): { filled: boolean; quality: number } {
    const value = field.currentValue || '';
    const minLength = MIN_CONTENT_LENGTH[fieldType] || MIN_CONTENT_LENGTH.default;

    // Check if filled (meets minimum length)
    const filled = value.length >= minLength;

    // Calculate quality score (0-100)
    let quality = 0;

    if (value.length > 0) {
      // Base score from length
      const lengthRatio = Math.min(value.length / (minLength * 3), 1);
      quality = Math.round(lengthRatio * 60);

      // Bonus for structure (sentences, punctuation)
      if (value.includes('.') || value.includes(',')) quality += 15;

      // Bonus for medical terms (simple check)
      const medicalTerms = ['patient', 'denies', 'reports', 'presents', 'history', 'normal', 'abnormal'];
      if (medicalTerms.some(term => value.toLowerCase().includes(term))) quality += 15;

      // Bonus for complete sentences
      if (/[A-Z].*[.!?]$/.test(value.trim())) quality += 10;

      quality = Math.min(quality, 100);
    }

    return { filled, quality };
  }

  /**
   * Determine traffic light status
   */
  private determineStatus(filledRequired: number, totalRequired: number, score: number): AutopilotStatus {
    // All required fields must be filled for green
    if (filledRequired === totalRequired && totalRequired > 0 && score >= 70) {
      return 'green';
    }

    // At least half of required fields filled for yellow
    if (filledRequired >= totalRequired / 2 || score >= 40) {
      return 'yellow';
    }

    return 'red';
  }

  /**
   * Generate improvement suggestions
   */
  private generateSuggestions(fieldScores: FieldScore[], status: AutopilotStatus): string[] {
    const suggestions: string[] = [];

    // Find unfilled required fields
    const unfilledRequired = fieldScores.filter(f => f.required && !f.filled);
    for (const field of unfilledRequired) {
      suggestions.push(`Complete ${field.label} (required)`);
    }

    // Find low-quality fields
    const lowQualityFields = fieldScores.filter(f => f.filled && f.quality < QUALITY_THRESHOLDS.fair);
    for (const field of lowQualityFields) {
      suggestions.push(`Expand ${field.label} (currently brief)`);
    }

    // Status-specific suggestions
    if (status === 'red' && suggestions.length === 0) {
      suggestions.push('Begin documentation by completing Chief Complaint');
    }

    if (status === 'yellow') {
      const unfilledImportant = fieldScores.filter(f => !f.required && !f.filled);
      if (unfilledImportant.length > 0) {
        suggestions.push(`Consider adding: ${unfilledImportant.map(f => f.label).join(', ')}`);
      }
    }

    return suggestions.slice(0, 5); // Max 5 suggestions
  }

  /**
   * Record coverage in history
   */
  private recordCoverage(tabId: string, report: CoverageReport): void {
    if (!this.coverageHistory.has(tabId)) {
      this.coverageHistory.set(tabId, []);
    }

    const history = this.coverageHistory.get(tabId)!;
    history.push(report);

    // Trim if too large
    if (history.length > this.maxHistorySize) {
      this.coverageHistory.set(tabId, history.slice(-this.maxHistorySize));
    }
  }

  /**
   * Get coverage trend for a tab
   */
  getCoverageTrend(tabId: string): { improving: boolean; recentScores: number[] } {
    const history = this.coverageHistory.get(tabId) || [];
    const recentScores = history.slice(-10).map(h => h.score);

    // Calculate if improving (simple linear trend)
    let improving = false;
    if (recentScores.length >= 3) {
      const first = recentScores.slice(0, Math.floor(recentScores.length / 2));
      const second = recentScores.slice(Math.floor(recentScores.length / 2));
      const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
      const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
      improving = avgSecond > avgFirst;
    }

    return { improving, recentScores };
  }

  /**
   * Get last coverage report for a tab
   */
  getLastReport(tabId: string): CoverageReport | undefined {
    const history = this.coverageHistory.get(tabId);
    return history?.[history.length - 1];
  }

  /**
   * Clear data for a tab
   */
  clearTab(tabId: string): void {
    this.coverageHistory.delete(tabId);
  }

  /**
   * Check if documentation is ready for sign-off
   */
  isReadyForSignoff(tabId: string): { ready: boolean; reason: string } {
    const report = this.getLastReport(tabId);

    if (!report) {
      return { ready: false, reason: 'No coverage data available' };
    }

    if (report.status !== 'green') {
      return {
        ready: false,
        reason: `Status is ${report.status}. ${report.suggestions[0] || 'Complete required fields.'}`
      };
    }

    if (report.required.filled < report.required.total) {
      return {
        ready: false,
        reason: `Missing ${report.required.total - report.required.filled} required field(s)`
      };
    }

    return { ready: true, reason: 'All required documentation complete' };
  }
}

// Singleton instance
export const autopilot = new Autopilot();
