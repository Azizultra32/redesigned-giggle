/**
 * Auto-Fill Service
 *
 * Fills form fields with transcript data.
 * Supports undo, batch operations, and human-like typing.
 */

import { Page } from 'playwright';
import {
  DetectedField,
  FillRequest,
  FillResult,
  FillBatch,
  FieldMapping,
  TranscriptSource
} from './types.js';
import { FieldDetector } from './detector.js';

// Undo history entry
interface UndoEntry {
  fieldId: string;
  selector: string;
  previousValue: string;
  timestamp: number;
}

export class AutoFiller {
  private page: Page;
  private detector: FieldDetector;
  private undoStack: UndoEntry[] = [];
  private maxUndoHistory = 50;
  private pendingBatches: Map<string, FillBatch> = new Map();

  constructor(page: Page, detector: FieldDetector) {
    this.page = page;
    this.detector = detector;
  }

  /**
   * Fill a single field
   */
  async fillField(request: FillRequest): Promise<FillResult> {
    try {
      const element = await this.page.$(request.selector);
      if (!element) {
        return {
          fieldId: request.fieldId,
          success: false,
          error: 'Element not found'
        };
      }

      // Get current value for undo
      const previousValue = await this.getFieldValue(request.selector);

      // Store in undo stack
      this.addToUndoStack({
        fieldId: request.fieldId,
        selector: request.selector,
        previousValue,
        timestamp: Date.now()
      });

      // Determine fill strategy
      const field = this.detector.getField(request.fieldId);
      const fieldType = field?.type || 'text';

      // Perform fill based on field type
      await this.performFill(request.selector, request.value, fieldType, request.append);

      // Get new value for confirmation
      const newValue = await this.getFieldValue(request.selector);

      return {
        fieldId: request.fieldId,
        success: true,
        previousValue,
        newValue
      };
    } catch (error) {
      return {
        fieldId: request.fieldId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fill multiple fields in a batch
   */
  async fillBatch(requests: FillRequest[]): Promise<FillBatch> {
    const batch: FillBatch = {
      id: `batch_${Date.now()}`,
      requests,
      status: 'in-progress',
      results: [],
      createdAt: Date.now()
    };

    this.pendingBatches.set(batch.id, batch);

    try {
      for (const request of requests) {
        const result = await this.fillField(request);
        batch.results.push(result);

        // Optional: add small delay for human-like behavior
        await this.page.waitForTimeout(50);
      }

      batch.status = batch.results.every(r => r.success) ? 'completed' : 'failed';
    } catch (error) {
      batch.status = 'failed';
    }

    batch.completedAt = Date.now();
    return batch;
  }

  /**
   * Undo the last fill operation
   */
  async undoLast(): Promise<FillResult | null> {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    try {
      const element = await this.page.$(entry.selector);
      if (!element) {
        return {
          fieldId: entry.fieldId,
          success: false,
          error: 'Element not found for undo'
        };
      }

      const field = this.detector.getField(entry.fieldId);
      const fieldType = field?.type || 'text';

      await this.performFill(entry.selector, entry.previousValue, fieldType, false);

      return {
        fieldId: entry.fieldId,
        success: true,
        newValue: entry.previousValue
      };
    } catch (error) {
      return {
        fieldId: entry.fieldId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Undo a specific field's fill
   */
  async undoField(fieldId: string): Promise<FillResult | null> {
    // Find the most recent entry for this field
    const entryIndex = [...this.undoStack].reverse().findIndex(e => e.fieldId === fieldId);
    if (entryIndex === -1) return null;

    const actualIndex = this.undoStack.length - 1 - entryIndex;
    const entry = this.undoStack.splice(actualIndex, 1)[0];

    try {
      const field = this.detector.getField(entry.fieldId);
      const fieldType = field?.type || 'text';

      await this.performFill(entry.selector, entry.previousValue, fieldType, false);

      return {
        fieldId: entry.fieldId,
        success: true,
        newValue: entry.previousValue
      };
    } catch (error) {
      return {
        fieldId: entry.fieldId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Clear the undo stack
   */
  clearUndoStack(): void {
    this.undoStack = [];
  }

  /**
   * Get undo stack size
   */
  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  /**
   * Create a field mapping
   */
  createMapping(
    fieldId: string,
    fieldSelector: string,
    source: TranscriptSource,
    autoFill: boolean = false
  ): FieldMapping {
    return {
      id: `mapping_${Date.now()}`,
      fieldSelector,
      transcriptSource: source,
      autoFill,
      createdAt: Date.now()
    };
  }

  // ============================================
  // Private Methods
  // ============================================

  private async performFill(
    selector: string,
    value: string,
    fieldType: string,
    append?: boolean
  ): Promise<void> {
    const element = await this.page.$(selector);
    if (!element) throw new Error('Element not found');

    switch (fieldType) {
      case 'select':
        await element.selectOption(value);
        break;

      case 'checkbox':
        const isChecked = await element.isChecked();
        const shouldBeChecked = value === 'true' || value === '1';
        if (isChecked !== shouldBeChecked) {
          await element.click();
        }
        break;

      case 'radio':
        await element.click();
        break;

      case 'contenteditable':
      case 'rich-text':
        await this.fillContentEditable(selector, value, append);
        break;

      case 'textarea':
        await this.fillTextarea(selector, value, append);
        break;

      default:
        await this.fillInput(selector, value, append);
    }

    // Trigger change events
    await this.triggerEvents(selector);
  }

  private async fillInput(selector: string, value: string, append?: boolean): Promise<void> {
    if (append) {
      const current = await this.getFieldValue(selector);
      value = current + value;
    }

    // Clear and type for better compatibility
    await this.page.click(selector, { clickCount: 3 }); // Select all
    await this.page.keyboard.press('Backspace');
    await this.page.type(selector, value, { delay: 10 }); // Human-like typing
  }

  private async fillTextarea(selector: string, value: string, append?: boolean): Promise<void> {
    if (append) {
      const current = await this.getFieldValue(selector);
      value = current + '\n' + value;
    }

    await this.page.click(selector);
    await this.page.evaluate(
      ({ sel, val }) => {
        const el = document.querySelector(sel) as HTMLTextAreaElement;
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
      { sel: selector, val: value }
    );
  }

  private async fillContentEditable(selector: string, value: string, append?: boolean): Promise<void> {
    await this.page.evaluate(
      ({ sel, val, shouldAppend }) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) {
          if (shouldAppend) {
            el.innerHTML += '<p>' + val + '</p>';
          } else {
            el.innerHTML = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
      { sel: selector, val: value, shouldAppend: append }
    );
  }

  private async getFieldValue(selector: string): Promise<string> {
    return await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return '';

      const htmlEl = el as HTMLElement;
      const inputEl = el as HTMLInputElement;

      if (htmlEl.isContentEditable) {
        return htmlEl.innerHTML || '';
      }

      if (inputEl.tagName === 'SELECT') {
        return (el as HTMLSelectElement).value || '';
      }

      return inputEl.value || '';
    }, selector);
  }

  private async triggerEvents(selector: string): Promise<void> {
    await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }, selector);
  }

  private addToUndoStack(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxUndoHistory) {
      this.undoStack.shift();
    }
  }
}
