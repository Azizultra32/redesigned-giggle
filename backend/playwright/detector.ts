/**
 * Form Field Detector
 *
 * Analyzes EHR pages to detect fillable form fields.
 * Uses heuristics and label matching to categorize fields.
 */

import { Page, ElementHandle } from 'playwright';
import {
  DetectedField,
  FieldType,
  FieldCategory,
  BoundingBox,
  EhrType
} from './types.js';

// Field category patterns
const CATEGORY_PATTERNS: Record<FieldCategory, RegExp[]> = {
  'chief-complaint': [/chief\s*complaint/i, /cc:/i, /reason\s*for\s*visit/i, /presenting\s*problem/i],
  'history-present-illness': [/history\s*of\s*present/i, /hpi/i, /present\s*illness/i],
  'review-of-systems': [/review\s*of\s*systems/i, /ros/i, /systems\s*review/i],
  'physical-exam': [/physical\s*exam/i, /pe:/i, /examination/i, /exam\s*findings/i],
  'assessment': [/assessment/i, /impression/i, /diagnosis/i, /dx:/i],
  'plan': [/plan/i, /treatment\s*plan/i, /recommendations/i, /follow[\s-]*up/i],
  'medications': [/medications?/i, /meds/i, /prescriptions?/i, /rx:/i],
  'allergies': [/allergies/i, /allergy/i, /adverse\s*reactions/i],
  'vitals': [/vitals?/i, /vital\s*signs/i, /bp|blood\s*pressure/i, /pulse/i, /temp/i],
  'diagnosis': [/diagnosis/i, /icd/i, /diagnostic\s*code/i],
  'procedure': [/procedure/i, /cpt/i, /intervention/i],
  'note': [/notes?/i, /comments?/i, /additional/i, /other/i],
  'unknown': []
};

// Common input selectors
const INPUT_SELECTORS = [
  'input[type="text"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input[type="number"]',
  'input[type="date"]',
  'input[type="time"]',
  'input:not([type])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '.ql-editor', // Quill
  '.note-editable', // Summernote
  '.mce-content-body', // TinyMCE
  '.cke_editable', // CKEditor
  '.ProseMirror' // ProseMirror
];

export class FieldDetector {
  private page: Page;
  private ehrType: EhrType;
  private detectedFields: Map<string, DetectedField> = new Map();

  constructor(page: Page, ehrType: EhrType = 'unknown') {
    this.page = page;
    this.ehrType = ehrType;
  }

  /**
   * Scan the page for all fillable fields
   */
  async detectFields(): Promise<DetectedField[]> {
    this.detectedFields.clear();

    const selector = INPUT_SELECTORS.join(', ');
    const elements = await this.page.$$(selector);

    for (const element of elements) {
      const field = await this.analyzeElement(element);
      if (field && field.isVisible) {
        this.detectedFields.set(field.id, field);
      }
    }

    return Array.from(this.detectedFields.values());
  }

  /**
   * Detect fields within a specific container
   */
  async detectFieldsInContainer(containerSelector: string): Promise<DetectedField[]> {
    const container = await this.page.$(containerSelector);
    if (!container) return [];

    const selector = INPUT_SELECTORS.join(', ');
    const elements = await container.$$(selector);

    const fields: DetectedField[] = [];
    for (const element of elements) {
      const field = await this.analyzeElement(element);
      if (field && field.isVisible) {
        fields.push(field);
        this.detectedFields.set(field.id, field);
      }
    }

    return fields;
  }

  /**
   * Get a specific field by ID
   */
  getField(fieldId: string): DetectedField | undefined {
    return this.detectedFields.get(fieldId);
  }

  /**
   * Get all detected fields
   */
  getAllFields(): DetectedField[] {
    return Array.from(this.detectedFields.values());
  }

  /**
   * Find fields by category
   */
  getFieldsByCategory(category: FieldCategory): DetectedField[] {
    return this.getAllFields().filter(f => f.category === category);
  }

  /**
   * Analyze a single element
   */
  private async analyzeElement(element: ElementHandle): Promise<DetectedField | null> {
    try {
      // Get element properties
      const props = await element.evaluate((el) => {
        const htmlEl = el as HTMLElement;
        const inputEl = el as HTMLInputElement;

        // Check visibility
        const style = window.getComputedStyle(htmlEl);
        const isVisible = style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          htmlEl.offsetParent !== null;

        // Get bounding box
        const rect = htmlEl.getBoundingClientRect();

        // Get tag and type
        const tagName = htmlEl.tagName.toLowerCase();
        const inputType = inputEl.type?.toLowerCase() || '';

        // Get value
        let value = '';
        if (tagName === 'input' || tagName === 'textarea') {
          value = inputEl.value || '';
        } else if (tagName === 'select') {
          value = (el as HTMLSelectElement).value || '';
        } else if (htmlEl.isContentEditable) {
          value = htmlEl.textContent || '';
        }

        // Find associated label
        let label = '';

        // Try explicit label via 'for' attribute
        if (inputEl.id) {
          const labelEl = document.querySelector(`label[for="${inputEl.id}"]`);
          if (labelEl) {
            label = labelEl.textContent?.trim() || '';
          }
        }

        // Try parent label
        if (!label) {
          const parentLabel = htmlEl.closest('label');
          if (parentLabel) {
            label = parentLabel.textContent?.trim() || '';
          }
        }

        // Try aria-label
        if (!label) {
          label = htmlEl.getAttribute('aria-label') ||
            htmlEl.getAttribute('aria-labelledby') ||
            htmlEl.getAttribute('placeholder') ||
            htmlEl.getAttribute('name') ||
            '';
        }

        // Try preceding sibling or parent text
        if (!label) {
          const prev = htmlEl.previousElementSibling;
          if (prev && prev.textContent && prev.textContent.length < 100) {
            label = prev.textContent.trim();
          }
        }

        // Generate unique selector
        let selector = '';
        if (inputEl.id) {
          selector = `#${CSS.escape(inputEl.id)}`;
        } else if (inputEl.name) {
          selector = `[name="${CSS.escape(inputEl.name)}"]`;
        } else {
          // Generate a path-based selector
          const path: string[] = [];
          let current: Element | null = htmlEl;
          while (current && current !== document.body) {
            let segm = current.tagName.toLowerCase();
            if (current.id) {
              segm = `#${CSS.escape(current.id)}`;
              path.unshift(segm);
              break;
            }
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(
                c => c.tagName === current!.tagName
              );
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                segm += `:nth-of-type(${index})`;
              }
            }
            path.unshift(segm);
            current = parent;
          }
          selector = path.join(' > ');
        }

        // Check if editable
        const isEditable = !inputEl.disabled &&
          !inputEl.readOnly &&
          htmlEl.getAttribute('aria-readonly') !== 'true';

        return {
          tagName,
          inputType,
          value,
          label,
          selector,
          isVisible,
          isEditable,
          isContentEditable: htmlEl.isContentEditable,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        };
      });

      if (!props.isVisible) return null;

      // Determine field type
      const fieldType = this.determineFieldType(props.tagName, props.inputType, props.isContentEditable);

      // Determine category from label
      const category = this.categorizeField(props.label);

      // Generate field ID
      const fieldId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Calculate confidence
      const confidence = this.calculateConfidence(props.label, category);

      return {
        id: fieldId,
        selector: props.selector,
        type: fieldType,
        label: props.label,
        value: props.value,
        isEditable: props.isEditable,
        isVisible: props.isVisible,
        boundingBox: props.boundingBox,
        confidence,
        category
      };
    } catch {
      return null;
    }
  }

  /**
   * Determine field type from element properties
   */
  private determineFieldType(
    tagName: string,
    inputType: string,
    isContentEditable: boolean
  ): FieldType {
    if (isContentEditable) return 'contenteditable';

    if (tagName === 'textarea') return 'textarea';
    if (tagName === 'select') return 'select';

    switch (inputType) {
      case 'checkbox': return 'checkbox';
      case 'radio': return 'radio';
      case 'date': return 'date';
      case 'time': return 'time';
      case 'number': return 'number';
      case 'email': return 'email';
      case 'tel': return 'phone';
      default: return 'text';
    }
  }

  /**
   * Categorize field based on label text
   */
  private categorizeField(label: string): FieldCategory {
    if (!label) return 'unknown';

    const lowerLabel = label.toLowerCase();

    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      if (category === 'unknown') continue;
      for (const pattern of patterns) {
        if (pattern.test(lowerLabel)) {
          return category as FieldCategory;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Calculate confidence score for field detection
   */
  private calculateConfidence(label: string, category: FieldCategory): number {
    let confidence = 0.5; // Base confidence

    // Has a label
    if (label && label.length > 0) {
      confidence += 0.2;
    }

    // Has a known category
    if (category !== 'unknown') {
      confidence += 0.2;
    }

    // Label is reasonably sized
    if (label && label.length > 3 && label.length < 100) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Highlight a field on the page for visual feedback
   */
  async highlightField(fieldId: string, color: string = '#e63946'): Promise<void> {
    const field = this.detectedFields.get(fieldId);
    if (!field) return;

    await this.page.evaluate(
      ({ selector, color }) => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) {
          el.style.outline = `3px solid ${color}`;
          el.style.outlineOffset = '2px';
          el.dataset.assistmdHighlight = 'true';
        }
      },
      { selector: field.selector, color }
    );
  }

  /**
   * Clear all highlights
   */
  async clearHighlights(): Promise<void> {
    await this.page.evaluate(() => {
      const elements = document.querySelectorAll('[data-assistmd-highlight]');
      elements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.outline = '';
        htmlEl.style.outlineOffset = '';
        delete htmlEl.dataset.assistmdHighlight;
      });
    });
  }
}
