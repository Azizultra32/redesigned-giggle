/**
 * Smart Fill Engine - Executes fill steps on DOM elements
 *
 * Receives tasks from backend and executes them sequentially on the page.
 * Supports fill, click, select, and clear actions with delays.
 */

export interface FillStep {
  id: string;
  selector: string;
  action: 'fill' | 'click' | 'select' | 'clear';
  value?: string;
  delay?: number;
}

export interface FillResult {
  stepId: string;
  success: boolean;
  error?: string;
  previousValue?: string;
}

export interface FillReport {
  totalSteps: number;
  completed: number;
  failed: number;
  results: FillResult[];
  startTime: number;
  endTime: number;
}

type ProgressCallback = (stepIndex: number, total: number, result: FillResult) => void;

export class SmartFillEngine {
  private undoStack: { selector: string; previousValue: string }[] = [];
  private isRunning = false;
  private abortController: AbortController | null = null;

  /**
   * Execute a sequence of fill steps
   */
  async execute(
    steps: FillStep[],
    onProgress?: ProgressCallback
  ): Promise<FillReport> {
    if (this.isRunning) {
      throw new Error('Smart Fill is already running');
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.undoStack = [];

    const report: FillReport = {
      totalSteps: steps.length,
      completed: 0,
      failed: 0,
      results: [],
      startTime: Date.now(),
      endTime: 0
    };

    try {
      for (let i = 0; i < steps.length; i++) {
        if (this.abortController.signal.aborted) {
          break;
        }

        const step = steps[i];
        const result = await this.executeStep(step);
        report.results.push(result);

        if (result.success) {
          report.completed++;
          // Store for undo
          if (result.previousValue !== undefined) {
            this.undoStack.push({
              selector: step.selector,
              previousValue: result.previousValue
            });
          }
        } else {
          report.failed++;
        }

        if (onProgress) {
          onProgress(i, steps.length, result);
        }

        // Apply delay between steps
        if (step.delay && i < steps.length - 1) {
          await this.delay(step.delay);
        }
      }
    } finally {
      this.isRunning = false;
      this.abortController = null;
      report.endTime = Date.now();
    }

    return report;
  }

  /**
   * Execute a single fill step
   */
  private async executeStep(step: FillStep): Promise<FillResult> {
    const result: FillResult = {
      stepId: step.id,
      success: false
    };

    try {
      const element = document.querySelector(step.selector) as HTMLElement;

      if (!element) {
        result.error = `Element not found: ${step.selector}`;
        return result;
      }

      switch (step.action) {
        case 'fill':
          result.previousValue = await this.fillElement(element, step.value || '');
          result.success = true;
          break;

        case 'click':
          await this.clickElement(element);
          result.success = true;
          break;

        case 'select':
          result.previousValue = await this.selectElement(element, step.value || '');
          result.success = true;
          break;

        case 'clear':
          result.previousValue = await this.clearElement(element);
          result.success = true;
          break;

        default:
          result.error = `Unknown action: ${step.action}`;
      }
    } catch (error: any) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * Fill an input/textarea element
   */
  private async fillElement(element: HTMLElement, value: string): Promise<string> {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const previousValue = input.value || '';

    // Focus element
    input.focus();

    // Clear existing value
    input.value = '';

    // Simulate typing character by character for better compatibility
    for (const char of value) {
      input.value += char;

      // Dispatch input event
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Small delay between characters for natural typing
      await this.delay(10);
    }

    // Dispatch change event
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Blur to trigger validation
    input.blur();

    return previousValue;
  }

  /**
   * Click an element
   */
  private async clickElement(element: HTMLElement): Promise<void> {
    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(100);

    // Focus if focusable
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.focus();
    }

    // Dispatch click events
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  /**
   * Select an option in a select element
   */
  private async selectElement(element: HTMLElement, value: string): Promise<string> {
    const select = element as HTMLSelectElement;
    const previousValue = select.value;

    // Find option by value or text
    let optionFound = false;
    for (const option of Array.from(select.options)) {
      if (option.value === value || option.text.toLowerCase().includes(value.toLowerCase())) {
        select.value = option.value;
        optionFound = true;
        break;
      }
    }

    if (!optionFound) {
      throw new Error(`Option not found: ${value}`);
    }

    // Dispatch change event
    select.dispatchEvent(new Event('change', { bubbles: true }));

    return previousValue;
  }

  /**
   * Clear an element's value
   */
  private async clearElement(element: HTMLElement): Promise<string> {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const previousValue = input.value || '';

    input.focus();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();

    return previousValue;
  }

  /**
   * Undo all fill operations
   */
  async undo(): Promise<number> {
    let undoneCount = 0;

    while (this.undoStack.length > 0) {
      const { selector, previousValue } = this.undoStack.pop()!;

      try {
        const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
        if (element) {
          element.value = previousValue;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          undoneCount++;
        }
      } catch (error) {
        console.error(`[SmartFill] Failed to undo ${selector}:`, error);
      }
    }

    return undoneCount;
  }

  /**
   * Abort running fill operation
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if fill is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get undo stack size
   */
  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Highlight an element temporarily
   */
  highlightElement(selector: string, duration: number = 2000): void {
    const element = document.querySelector(selector) as HTMLElement;
    if (!element) return;

    const originalOutline = element.style.outline;
    const originalTransition = element.style.transition;

    element.style.transition = 'outline 0.2s ease';
    element.style.outline = '3px solid #3b82f6';

    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.transition = originalTransition;
    }, duration);
  }

  /**
   * Highlight all fillable elements
   */
  highlightAllTargets(steps: FillStep[]): void {
    for (const step of steps) {
      this.highlightElement(step.selector, 3000);
    }
  }
}

// Singleton instance
export const smartFillEngine = new SmartFillEngine();
