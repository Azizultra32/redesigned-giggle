/**
 * Smart Fill Engine - DOM Field Auto-Fill Execution
 *
 * Executes fill steps received from the backend command router.
 * Handles DOM manipulation with undo capability.
 */

export interface FillStep {
  fieldId: string;
  fieldName: string;
  value: string;
  confidence: number;
  source: 'transcript' | 'inferred' | 'template';
}

export interface UndoEntry {
  fieldId: string;
  previousValue: string;
  newValue: string;
  timestamp: number;
}

export interface FillResult {
  success: boolean;
  filledCount: number;
  failedCount: number;
  errors: string[];
}

type FillProgressCallback = (step: FillStep, index: number, total: number) => void;
type FillCompleteCallback = (result: FillResult) => void;

export class SmartFillEngine {
  private undoStack: UndoEntry[] = [];
  private onProgress?: FillProgressCallback;
  private onComplete?: FillCompleteCallback;

  /**
   * Execute fill steps on the DOM
   */
  async execute(steps: FillStep[]): Promise<FillResult> {
    const result: FillResult = {
      success: true,
      filledCount: 0,
      failedCount: 0,
      errors: []
    };

    // Clear previous undo stack
    this.undoStack = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      try {
        const filled = await this.fillField(step);
        if (filled) {
          result.filledCount++;
        } else {
          result.failedCount++;
          result.errors.push(`Field not found: ${step.fieldName}`);
        }
      } catch (error: any) {
        result.failedCount++;
        result.errors.push(`Error filling ${step.fieldName}: ${error.message}`);
      }

      // Notify progress
      this.onProgress?.(step, i + 1, steps.length);

      // Small delay between fills for visual feedback
      await this.delay(50);
    }

    result.success = result.failedCount === 0;
    this.onComplete?.(result);

    return result;
  }

  /**
   * Fill a single field
   */
  private async fillField(step: FillStep): Promise<boolean> {
    // Find the element by ID or data attributes
    let element = this.findElement(step.fieldId);

    if (!element) {
      console.warn(`[SmartFill] Element not found: ${step.fieldId}`);
      return false;
    }

    // Store previous value for undo
    const previousValue = this.getElementValue(element);

    // Set the new value
    const success = this.setElementValue(element, step.value);

    if (success) {
      // Add to undo stack
      this.undoStack.push({
        fieldId: step.fieldId,
        previousValue,
        newValue: step.value,
        timestamp: Date.now()
      });

      // Highlight the field briefly
      this.highlightElement(element);
    }

    return success;
  }

  /**
   * Find element by various selectors
   */
  private findElement(fieldId: string): HTMLElement | null {
    // Try by ID
    let element = document.getElementById(fieldId);
    if (element) return element;

    // Try by name
    element = document.querySelector(`[name="${fieldId}"]`) as HTMLElement;
    if (element) return element;

    // Try by data attribute
    element = document.querySelector(`[data-field-id="${fieldId}"]`) as HTMLElement;
    if (element) return element;

    // Try by aria-label
    element = document.querySelector(`[aria-label="${fieldId}"]`) as HTMLElement;
    if (element) return element;

    return null;
  }

  /**
   * Get current value from element
   */
  private getElementValue(element: HTMLElement): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.value;
    }
    if (element.isContentEditable) {
      return element.textContent || '';
    }
    return '';
  }

  /**
   * Set value on element
   */
  private setElementValue(element: HTMLElement, value: string): boolean {
    try {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        // Trigger focus
        element.focus();

        // Set value
        element.value = value;

        // Dispatch events for frameworks
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        return true;
      }

      if (element instanceof HTMLSelectElement) {
        // Find option with matching value
        const option = Array.from(element.options).find(
          opt => opt.value === value || opt.text.toLowerCase().includes(value.toLowerCase())
        );

        if (option) {
          element.value = option.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        return false;
      }

      if (element.isContentEditable) {
        element.focus();
        element.textContent = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }

      return false;
    } catch (error) {
      console.error('[SmartFill] Error setting value:', error);
      return false;
    }
  }

  /**
   * Highlight element briefly
   */
  private highlightElement(element: HTMLElement): void {
    const originalOutline = element.style.outline;
    const originalTransition = element.style.transition;

    element.style.transition = 'outline 0.2s ease-in-out';
    element.style.outline = '2px solid #22c55e';

    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.transition = originalTransition;
    }, 1000);
  }

  /**
   * Undo all fill operations
   */
  async undo(): Promise<FillResult> {
    const result: FillResult = {
      success: true,
      filledCount: 0,
      failedCount: 0,
      errors: []
    };

    // Process undo stack in reverse order
    const undoEntries = [...this.undoStack].reverse();

    for (const entry of undoEntries) {
      try {
        const element = this.findElement(entry.fieldId);
        if (element) {
          const success = this.setElementValue(element, entry.previousValue);
          if (success) {
            result.filledCount++;
            this.highlightUndoElement(element);
          } else {
            result.failedCount++;
          }
        } else {
          result.failedCount++;
          result.errors.push(`Element not found for undo: ${entry.fieldId}`);
        }
      } catch (error: any) {
        result.failedCount++;
        result.errors.push(`Undo error for ${entry.fieldId}: ${error.message}`);
      }

      await this.delay(30);
    }

    // Clear undo stack
    this.undoStack = [];

    result.success = result.failedCount === 0;
    return result;
  }

  /**
   * Highlight element during undo
   */
  private highlightUndoElement(element: HTMLElement): void {
    const originalOutline = element.style.outline;
    const originalTransition = element.style.transition;

    element.style.transition = 'outline 0.2s ease-in-out';
    element.style.outline = '2px solid #f59e0b';

    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.transition = originalTransition;
    }, 1000);
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: FillProgressCallback): void {
    this.onProgress = callback;
  }

  /**
   * Set complete callback
   */
  setCompleteCallback(callback: FillCompleteCallback): void {
    this.onComplete = callback;
  }

  /**
   * Get undo stack
   */
  getUndoStack(): UndoEntry[] {
    return [...this.undoStack];
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Clear undo stack
   */
  clearUndoStack(): void {
    this.undoStack = [];
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const smartFillEngine = new SmartFillEngine();
