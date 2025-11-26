/**
 * Command Router - MAP/FILL/UNDO/SEND Command Handler
 *
 * Processes overlay commands and generates execution steps
 * for smart-fill, field mapping, and form submission.
 */

import { DomField, DomMap, TabManager } from './tab-manager.js';

export type CommandAction = 'map' | 'fill' | 'undo' | 'send';

export interface CommandRequest {
  action: CommandAction;
  tabId: string;
  payload?: Record<string, any>;
}

export interface FillStep {
  fieldId: string;
  fieldName: string;
  value: string;
  confidence: number;
  source: 'transcript' | 'inferred' | 'template';
}

export interface CommandResult {
  success: boolean;
  action: CommandAction;
  steps?: FillStep[];
  undoStack?: FillStep[];
  message?: string;
  error?: string;
}

export interface TranscriptData {
  fullText: string;
  chunks: Array<{
    speaker: number;
    text: string;
    timestamp: number;
  }>;
}

export class CommandRouter {
  private tabManager: TabManager;
  private undoStacks: Map<string, FillStep[]> = new Map();
  private transcriptData: Map<string, TranscriptData> = new Map();
  private currentDomMaps: Map<string, DomField[]> = new Map();

  constructor(tabManager: TabManager) {
    this.tabManager = tabManager;
  }

  /**
   * Process a command from the overlay
   */
  async processCommand(request: CommandRequest): Promise<CommandResult> {
    const { action, tabId, payload } = request;

    console.log(`[CommandRouter] Processing command: ${action} for tab ${tabId}`);

    switch (action) {
      case 'map':
        return this.handleMap(tabId, payload);

      case 'fill':
        return this.handleFill(tabId, payload);

      case 'undo':
        return this.handleUndo(tabId);

      case 'send':
        return this.handleSend(tabId, payload);

      default:
        return {
          success: false,
          action,
          error: `Unknown action: ${action}`
        };
    }
  }

  /**
   * Update DOM map for a tab (called when overlay sends dom_map)
   */
  updateDomMap(tabId: string, domMap: DomMap): void {
    this.currentDomMaps.set(tabId, domMap.fields);
    this.tabManager.updateDomMap(tabId, domMap);
  }

  /**
   * Update transcript data for a tab
   */
  updateTranscript(tabId: string, data: TranscriptData): void {
    this.transcriptData.set(tabId, data);
  }

  /**
   * Handle MAP command - analyze DOM and prepare field mapping
   */
  private async handleMap(tabId: string, payload?: Record<string, any>): Promise<CommandResult> {
    const domFields = this.currentDomMaps.get(tabId);

    if (!domFields || domFields.length === 0) {
      return {
        success: false,
        action: 'map',
        error: 'No DOM fields available. Please scan the page first.'
      };
    }

    // Return the available fields for mapping
    return {
      success: true,
      action: 'map',
      message: `Found ${domFields.length} fields available for mapping`,
      steps: domFields.map(field => ({
        fieldId: field.id,
        fieldName: field.name,
        value: field.value || '',
        confidence: 0,
        source: 'template' as const
      }))
    };
  }

  /**
   * Handle FILL command - generate fill steps from transcript
   */
  private async handleFill(tabId: string, payload?: Record<string, any>): Promise<CommandResult> {
    const domFields = this.currentDomMaps.get(tabId);
    const transcript = this.transcriptData.get(tabId);

    if (!domFields || domFields.length === 0) {
      return {
        success: false,
        action: 'fill',
        error: 'No DOM fields available. Please map fields first.'
      };
    }

    if (!transcript || !transcript.fullText) {
      return {
        success: false,
        action: 'fill',
        error: 'No transcript data available. Please record first.'
      };
    }

    // Generate fill steps based on transcript and field labels
    const fillSteps = this.generateFillSteps(domFields, transcript);

    // Save to undo stack
    this.undoStacks.set(tabId, fillSteps);

    return {
      success: true,
      action: 'fill',
      steps: fillSteps,
      message: `Generated ${fillSteps.length} fill operations`
    };
  }

  /**
   * Handle UNDO command - return previous state
   */
  private async handleUndo(tabId: string): Promise<CommandResult> {
    const undoStack = this.undoStacks.get(tabId);

    if (!undoStack || undoStack.length === 0) {
      return {
        success: false,
        action: 'undo',
        error: 'No actions to undo'
      };
    }

    // Clear the undo stack
    this.undoStacks.set(tabId, []);

    return {
      success: true,
      action: 'undo',
      undoStack,
      message: `Undo ${undoStack.length} operations`
    };
  }

  /**
   * Handle SEND command - prepare form submission
   */
  private async handleSend(tabId: string, payload?: Record<string, any>): Promise<CommandResult> {
    // In a real implementation, this would validate and submit
    // For now, just acknowledge the intent

    return {
      success: true,
      action: 'send',
      message: 'Form submission acknowledged. Please confirm in the EHR.'
    };
  }

  /**
   * Generate fill steps by matching transcript to field labels
   */
  private generateFillSteps(fields: DomField[], transcript: TranscriptData): FillStep[] {
    const steps: FillStep[] = [];
    const text = transcript.fullText.toLowerCase();

    // Common clinical field patterns
    const fieldPatterns: Record<string, RegExp[]> = {
      'chief_complaint': [
        /(?:chief complaint|cc|presenting with|came in for|here for)\s*[:\-]?\s*(.+?)(?:\.|$)/i,
        /patient (?:presents|presented|complains?) (?:with|of)\s*(.+?)(?:\.|$)/i
      ],
      'history_present_illness': [
        /(?:hpi|history of present illness)[:\-]?\s*(.+?)(?:review of systems|ros|$)/is,
        /(?:started|began|noticed|experiencing)\s*(.+?)(?:\.|$)/i
      ],
      'assessment': [
        /(?:assessment|diagnosis|impression)[:\-]?\s*(.+?)(?:plan|$)/is,
        /(?:likely|appears to be|diagnosed with)\s*(.+?)(?:\.|$)/i
      ],
      'plan': [
        /(?:plan|treatment|will)[:\-]?\s*(.+?)$/is,
        /(?:prescribe|order|recommend)\s*(.+?)(?:\.|$)/i
      ],
      'vitals': [
        /(?:blood pressure|bp)\s*[:\-]?\s*(\d+\/\d+)/i,
        /(?:temperature|temp)\s*[:\-]?\s*([\d.]+)/i,
        /(?:heart rate|hr|pulse)\s*[:\-]?\s*(\d+)/i
      ],
      'medications': [
        /(?:medications?|meds|rx)[:\-]?\s*(.+?)(?:\.|$)/i,
        /(?:taking|on)\s+([\w\s,]+(?:\d+\s*mg)?)/i
      ],
      'allergies': [
        /(?:allergies?|allergic to)[:\-]?\s*(.+?)(?:\.|$)/i,
        /(?:no known (?:drug )?allergies|nkda)/i
      ]
    };

    for (const field of fields) {
      const normalizedLabel = this.normalizeFieldLabel(field.label || field.name);
      let matchedValue = '';
      let confidence = 0;

      // Try to match field to patterns
      for (const [patternKey, patterns] of Object.entries(fieldPatterns)) {
        if (this.fieldMatchesPattern(normalizedLabel, patternKey)) {
          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
              matchedValue = this.cleanExtractedValue(match[1]);
              confidence = 0.7 + (match[1].length > 20 ? 0.2 : match[1].length / 100);
              break;
            }
          }
          if (matchedValue) break;
        }
      }

      // If no pattern match, try fuzzy matching
      if (!matchedValue && field.label) {
        const labelWords = field.label.toLowerCase().split(/\s+/);
        for (const word of labelWords) {
          if (word.length > 3 && text.includes(word)) {
            // Found a mention, extract surrounding context
            const idx = text.indexOf(word);
            const contextEnd = text.indexOf('.', idx);
            if (contextEnd > idx) {
              matchedValue = text.substring(idx, contextEnd).trim();
              confidence = 0.5;
              break;
            }
          }
        }
      }

      if (matchedValue) {
        steps.push({
          fieldId: field.id,
          fieldName: field.name,
          value: matchedValue,
          confidence: Math.min(confidence, 1.0),
          source: 'transcript'
        });
      }
    }

    return steps;
  }

  /**
   * Normalize field label for matching
   */
  private normalizeFieldLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/[_\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if field label matches a pattern category
   */
  private fieldMatchesPattern(normalizedLabel: string, patternKey: string): boolean {
    const mappings: Record<string, string[]> = {
      'chief_complaint': ['chief complaint', 'cc', 'reason for visit', 'presenting complaint'],
      'history_present_illness': ['hpi', 'history of present illness', 'present illness', 'illness history'],
      'assessment': ['assessment', 'diagnosis', 'impression', 'dx'],
      'plan': ['plan', 'treatment', 'treatment plan', 'recommendations'],
      'vitals': ['vitals', 'vital signs', 'bp', 'blood pressure', 'temp', 'temperature', 'heart rate', 'pulse'],
      'medications': ['medications', 'meds', 'current medications', 'rx'],
      'allergies': ['allergies', 'allergy', 'drug allergies', 'medication allergies']
    };

    const keywords = mappings[patternKey] || [];
    return keywords.some(keyword => normalizedLabel.includes(keyword));
  }

  /**
   * Clean extracted value
   */
  private cleanExtractedValue(value: string): string {
    return value
      .trim()
      .replace(/^[:\-,\s]+/, '')
      .replace(/[:\-,\s]+$/, '')
      .replace(/\s+/g, ' ')
      .substring(0, 500); // Limit length
  }

  /**
   * Get undo stack for a tab
   */
  getUndoStack(tabId: string): FillStep[] {
    return this.undoStacks.get(tabId) || [];
  }

  /**
   * Clear undo stack for a tab
   */
  clearUndoStack(tabId: string): void {
    this.undoStacks.delete(tabId);
  }
}
