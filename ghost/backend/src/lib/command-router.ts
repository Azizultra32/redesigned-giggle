/**
 * Command Router - handles map/fill/undo/send commands from overlay
 *
 * Part of the AssistMD Ghost System command pipeline.
 * Maps incoming commands to appropriate handlers and returns task lists.
 */

import { WebSocket } from 'ws';
import { DomMap, FillTask, CommandResult } from '../types/index.js';

export type CommandType = 'map' | 'fill' | 'undo' | 'send' | 'clear';

export interface Command {
  type: CommandType;
  tabId: string;
  payload?: any;
}

export interface FillStep {
  id: string;
  selector: string;
  action: 'fill' | 'click' | 'select' | 'clear';
  value?: string;
  delay?: number;
}

export interface CommandResponse {
  success: boolean;
  command: CommandType;
  tabId: string;
  tasks?: FillStep[];
  error?: string;
  message?: string;
}

// Track command history for undo
interface CommandHistory {
  tabId: string;
  command: Command;
  previousState: Map<string, string>;
  timestamp: number;
}

export class CommandRouter {
  private history: CommandHistory[] = [];
  private maxHistorySize = 50;

  // Track current DOM maps per tab
  private domMaps: Map<string, DomMap> = new Map();

  // Track pending fill operations per tab
  private pendingFills: Map<string, FillStep[]> = new Map();

  /**
   * Process incoming command
   */
  async execute(command: Command, ws: WebSocket): Promise<CommandResponse> {
    console.log(`[CommandRouter] Executing: ${command.type} for tab ${command.tabId}`);

    switch (command.type) {
      case 'map':
        return this.handleMap(command);
      case 'fill':
        return this.handleFill(command);
      case 'undo':
        return this.handleUndo(command);
      case 'send':
        return this.handleSend(command);
      case 'clear':
        return this.handleClear(command);
      default:
        return {
          success: false,
          command: command.type,
          tabId: command.tabId,
          error: `Unknown command: ${command.type}`
        };
    }
  }

  /**
   * MAP command - receives DOM map from overlay, stores it, returns field analysis
   */
  private handleMap(command: Command): CommandResponse {
    const { tabId, payload } = command;
    const domMap = payload as DomMap;

    if (!domMap || !domMap.fields) {
      return {
        success: false,
        command: 'map',
        tabId,
        error: 'Invalid DOM map: missing fields'
      };
    }

    // Store DOM map for this tab
    this.domMaps.set(tabId, domMap);

    // Analyze fields and create fill tasks
    const tasks = this.analyzeDomMap(domMap);

    console.log(`[CommandRouter] MAP: Stored ${domMap.fields.length} fields for tab ${tabId}`);

    return {
      success: true,
      command: 'map',
      tabId,
      tasks,
      message: `Mapped ${domMap.fields.length} fields, ${tasks.length} fillable`
    };
  }

  /**
   * FILL command - generates fill steps from transcript data
   */
  private handleFill(command: Command): CommandResponse {
    const { tabId, payload } = command;
    const domMap = this.domMaps.get(tabId);

    if (!domMap) {
      return {
        success: false,
        command: 'fill',
        tabId,
        error: 'No DOM map found for this tab. Run MAP first.'
      };
    }

    // Generate fill steps based on transcript content
    const transcriptData = payload?.transcript || '';
    const tasks = this.generateFillSteps(domMap, transcriptData);

    // Store for potential undo
    this.pendingFills.set(tabId, tasks);

    // Record in history
    this.recordHistory({
      tabId,
      command,
      previousState: this.captureFieldState(domMap),
      timestamp: Date.now()
    });

    console.log(`[CommandRouter] FILL: Generated ${tasks.length} fill steps for tab ${tabId}`);

    return {
      success: true,
      command: 'fill',
      tabId,
      tasks,
      message: `Generated ${tasks.length} fill steps`
    };
  }

  /**
   * UNDO command - reverts last fill operation
   */
  private handleUndo(command: Command): CommandResponse {
    const { tabId } = command;

    // Find last command for this tab
    const lastCommand = this.findLastCommand(tabId);

    if (!lastCommand) {
      return {
        success: false,
        command: 'undo',
        tabId,
        error: 'Nothing to undo'
      };
    }

    // Generate undo steps (restore previous values)
    const undoTasks: FillStep[] = [];
    lastCommand.previousState.forEach((value, selector) => {
      undoTasks.push({
        id: `undo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        selector,
        action: 'fill',
        value,
        delay: 50
      });
    });

    // Remove from history
    this.history = this.history.filter(h => h !== lastCommand);

    console.log(`[CommandRouter] UNDO: Reverting ${undoTasks.length} changes for tab ${tabId}`);

    return {
      success: true,
      command: 'undo',
      tabId,
      tasks: undoTasks,
      message: `Reverting ${undoTasks.length} field changes`
    };
  }

  /**
   * SEND command - finalize and submit the form/note
   */
  private handleSend(command: Command): CommandResponse {
    const { tabId, payload } = command;
    const domMap = this.domMaps.get(tabId);

    if (!domMap) {
      return {
        success: false,
        command: 'send',
        tabId,
        error: 'No DOM map found. Cannot determine submit action.'
      };
    }

    // Find submit button in DOM map
    const submitButton = domMap.fields.find(f =>
      f.type === 'button' &&
      (f.label?.toLowerCase().includes('submit') ||
       f.label?.toLowerCase().includes('save') ||
       f.label?.toLowerCase().includes('sign'))
    );

    const tasks: FillStep[] = [];

    if (submitButton) {
      tasks.push({
        id: `send-${Date.now()}`,
        selector: submitButton.selector,
        action: 'click',
        delay: 100
      });
    }

    // Clear history after send
    this.history = this.history.filter(h => h.tabId !== tabId);
    this.pendingFills.delete(tabId);

    console.log(`[CommandRouter] SEND: ${submitButton ? 'Found submit button' : 'No submit button found'}`);

    return {
      success: true,
      command: 'send',
      tabId,
      tasks,
      message: submitButton ? 'Submitting form' : 'No submit button found - manual submission required'
    };
  }

  /**
   * CLEAR command - clear filled fields
   */
  private handleClear(command: Command): CommandResponse {
    const { tabId } = command;
    const domMap = this.domMaps.get(tabId);

    if (!domMap) {
      return {
        success: false,
        command: 'clear',
        tabId,
        error: 'No DOM map found'
      };
    }

    // Generate clear steps for all fillable fields
    const tasks: FillStep[] = domMap.fields
      .filter(f => f.type === 'input' || f.type === 'textarea')
      .map(f => ({
        id: `clear-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        selector: f.selector,
        action: 'clear' as const,
        delay: 25
      }));

    console.log(`[CommandRouter] CLEAR: Clearing ${tasks.length} fields for tab ${tabId}`);

    return {
      success: true,
      command: 'clear',
      tabId,
      tasks,
      message: `Clearing ${tasks.length} fields`
    };
  }

  /**
   * Analyze DOM map and identify fillable fields
   */
  private analyzeDomMap(domMap: DomMap): FillStep[] {
    const tasks: FillStep[] = [];

    for (const field of domMap.fields) {
      if (field.type === 'input' || field.type === 'textarea' || field.type === 'select') {
        tasks.push({
          id: `field-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          selector: field.selector,
          action: field.type === 'select' ? 'select' : 'fill',
          value: '', // Will be filled by FILL command
          delay: 50
        });
      }
    }

    return tasks;
  }

  /**
   * Generate fill steps from transcript data
   * This is the "smart fill" logic that maps transcript content to fields
   */
  private generateFillSteps(domMap: DomMap, transcriptData: string): FillStep[] {
    const tasks: FillStep[] = [];

    // Field type patterns for smart matching
    const fieldPatterns: Record<string, RegExp[]> = {
      chief_complaint: [/chief\s*complaint/i, /cc\s*:/i, /reason\s*for\s*visit/i],
      hpi: [/history\s*of\s*present/i, /hpi\s*:/i],
      assessment: [/assessment/i, /diagnosis/i, /impression/i],
      plan: [/plan/i, /treatment/i, /recommendation/i],
      medications: [/medication/i, /rx/i, /prescription/i],
      allergies: [/allerg/i],
      vitals: [/vital/i, /bp/i, /blood\s*pressure/i, /temperature/i],
      ros: [/review\s*of\s*systems/i, /ros/i],
      physical_exam: [/physical\s*exam/i, /pe/i, /examination/i]
    };

    // Parse transcript into sections (simple approach)
    const sections = this.parseTranscriptSections(transcriptData);

    for (const field of domMap.fields) {
      if (field.type !== 'input' && field.type !== 'textarea') continue;

      const fieldLabel = (field.label || '').toLowerCase();
      const fieldName = (field.name || '').toLowerCase();

      // Find matching section from transcript
      let matchedContent = '';

      for (const [sectionType, patterns] of Object.entries(fieldPatterns)) {
        const matchesField = patterns.some(p =>
          p.test(fieldLabel) || p.test(fieldName)
        );

        if (matchesField && sections[sectionType]) {
          matchedContent = sections[sectionType];
          break;
        }
      }

      if (matchedContent) {
        tasks.push({
          id: `fill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          selector: field.selector,
          action: 'fill',
          value: matchedContent.trim(),
          delay: 100
        });
      }
    }

    return tasks;
  }

  /**
   * Parse transcript into sections based on common clinical patterns
   */
  private parseTranscriptSections(transcript: string): Record<string, string> {
    const sections: Record<string, string> = {};

    // Simple section detection (can be enhanced with AI later)
    const sectionMarkers = [
      { key: 'chief_complaint', patterns: [/chief\s*complaint[:\s]*(.*?)(?=(?:hpi|history|assessment|plan|$))/is] },
      { key: 'hpi', patterns: [/(?:hpi|history\s*of\s*present)[:\s]*(.*?)(?=(?:ros|review|assessment|plan|$))/is] },
      { key: 'ros', patterns: [/(?:ros|review\s*of\s*systems)[:\s]*(.*?)(?=(?:physical|pe|assessment|plan|$))/is] },
      { key: 'physical_exam', patterns: [/(?:physical\s*exam|pe)[:\s]*(.*?)(?=(?:assessment|diagnosis|plan|$))/is] },
      { key: 'assessment', patterns: [/(?:assessment|diagnosis|impression)[:\s]*(.*?)(?=(?:plan|treatment|$))/is] },
      { key: 'plan', patterns: [/(?:plan|treatment|recommendation)[:\s]*(.*?)$/is] }
    ];

    for (const { key, patterns } of sectionMarkers) {
      for (const pattern of patterns) {
        const match = transcript.match(pattern);
        if (match && match[1]) {
          sections[key] = match[1].trim();
          break;
        }
      }
    }

    return sections;
  }

  /**
   * Capture current field values for undo
   */
  private captureFieldState(domMap: DomMap): Map<string, string> {
    const state = new Map<string, string>();

    for (const field of domMap.fields) {
      if (field.currentValue !== undefined) {
        state.set(field.selector, field.currentValue);
      }
    }

    return state;
  }

  /**
   * Record command in history
   */
  private recordHistory(entry: CommandHistory): void {
    this.history.push(entry);

    // Trim history if too large
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }

  /**
   * Find last command for a tab
   */
  private findLastCommand(tabId: string): CommandHistory | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].tabId === tabId) {
        return this.history[i];
      }
    }
    return undefined;
  }

  /**
   * Update DOM map for a tab
   */
  updateDomMap(tabId: string, domMap: DomMap): void {
    this.domMaps.set(tabId, domMap);
  }

  /**
   * Get DOM map for a tab
   */
  getDomMap(tabId: string): DomMap | undefined {
    return this.domMaps.get(tabId);
  }

  /**
   * Clear all data for a tab (e.g., when tab closes)
   */
  clearTab(tabId: string): void {
    this.domMaps.delete(tabId);
    this.pendingFills.delete(tabId);
    this.history = this.history.filter(h => h.tabId !== tabId);
  }
}

// Singleton instance
export const commandRouter = new CommandRouter();
