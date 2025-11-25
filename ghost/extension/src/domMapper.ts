/**
 * DOM Mapper Module
 *
 * Detects and maps form fields in the host page DOM.
 * Used for auto-populating clinical documentation fields
 * and extracting patient information (name, MRN, DOB).
 */

import { Bridge } from './bridge';

export interface DetectedField {
  id: string;
  type: 'input' | 'textarea' | 'select' | 'contenteditable';
  selector: string;
  label: string;
  value: string;
  fieldType: FieldCategory;
  confidence: number;
  element: HTMLElement;
}

export type FieldCategory =
  | 'patient_name'
  | 'mrn'
  | 'dob'
  | 'chief_complaint'
  | 'history_present_illness'
  | 'assessment'
  | 'plan'
  | 'medications'
  | 'allergies'
  | 'vitals'
  | 'notes'
  | 'other';

export interface PatientInfo {
  name: string;
  mrn: string;
  dob?: string;
}

// Common field label patterns for healthcare forms
const FIELD_PATTERNS: Record<FieldCategory, RegExp[]> = {
  patient_name: [
    /patient\s*name/i,
    /pt\s*name/i,
    /name.*patient/i,
    /full\s*name/i
  ],
  mrn: [
    /mrn/i,
    /medical\s*record/i,
    /chart\s*number/i,
    /patient\s*id/i,
    /account/i
  ],
  dob: [
    /dob/i,
    /date\s*of\s*birth/i,
    /birth\s*date/i,
    /birthday/i
  ],
  chief_complaint: [
    /chief\s*complaint/i,
    /cc/i,
    /reason\s*for\s*visit/i,
    /presenting\s*complaint/i
  ],
  history_present_illness: [
    /hpi/i,
    /history.*present.*illness/i,
    /present\s*illness/i
  ],
  assessment: [
    /assessment/i,
    /diagnosis/i,
    /impression/i,
    /dx/i
  ],
  plan: [
    /plan/i,
    /treatment\s*plan/i,
    /care\s*plan/i
  ],
  medications: [
    /medication/i,
    /med\s*list/i,
    /prescription/i,
    /rx/i
  ],
  allergies: [
    /allerg/i,
    /drug\s*allerg/i,
    /sensitivity/i
  ],
  vitals: [
    /vital/i,
    /bp/i,
    /blood\s*pressure/i,
    /pulse/i,
    /temp/i,
    /heart\s*rate/i
  ],
  notes: [
    /note/i,
    /comment/i,
    /remark/i,
    /additional/i
  ],
  other: []
};

export class DOMMapper {
  private bridge: Bridge;
  private detectedFields: Map<string, DetectedField> = new Map();
  private observer: MutationObserver | null = null;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
    this.setupMutationObserver();
  }

  /**
   * Scan the DOM and detect all form fields
   */
  public detectFields(): DetectedField[] {
    console.log('[DOMMapper] Scanning for form fields...');

    this.detectedFields.clear();
    const fields: DetectedField[] = [];

    // Find all input elements
    const inputs = document.querySelectorAll<HTMLInputElement>(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])'
    );
    inputs.forEach(el => this.processField(el, 'input', fields));

    // Find all textareas
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
    textareas.forEach(el => this.processField(el, 'textarea', fields));

    // Find all selects
    const selects = document.querySelectorAll<HTMLSelectElement>('select');
    selects.forEach(el => this.processField(el, 'select', fields));

    // Find contenteditable elements
    const editables = document.querySelectorAll<HTMLElement>('[contenteditable="true"]');
    editables.forEach(el => this.processField(el, 'contenteditable', fields));

    console.log(`[DOMMapper] Detected ${fields.length} fields`);
    return fields;
  }

  /**
   * Extract patient information from the page
   */
  public extractPatientInfo(): PatientInfo | null {
    // First try to find dedicated patient fields
    const fields = this.detectFields();

    const nameField = fields.find(f => f.fieldType === 'patient_name' && f.value);
    const mrnField = fields.find(f => f.fieldType === 'mrn' && f.value);
    const dobField = fields.find(f => f.fieldType === 'dob' && f.value);

    if (nameField || mrnField) {
      return {
        name: nameField?.value || 'Unknown',
        mrn: mrnField?.value || '',
        dob: dobField?.value
      };
    }

    // Fallback: scan page content for patient info patterns
    return this.extractPatientInfoFromContent();
  }

  /**
   * Set a value into a detected field
   */
  public setFieldValue(fieldId: string, value: string): boolean {
    const field = this.detectedFields.get(fieldId);
    if (!field) {
      console.warn(`[DOMMapper] Field not found: ${fieldId}`);
      return false;
    }

    try {
      const element = field.element;

      if (field.type === 'contenteditable') {
        element.textContent = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        (element as HTMLInputElement).value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }

      console.log(`[DOMMapper] Set field ${fieldId} to:`, value.substring(0, 50));
      return true;
    } catch (error) {
      console.error(`[DOMMapper] Failed to set field ${fieldId}:`, error);
      return false;
    }
  }

  /**
   * Focus a specific field
   */
  public focusField(fieldId: string): boolean {
    const field = this.detectedFields.get(fieldId);
    if (!field) return false;

    try {
      field.element.focus();
      field.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    } catch {
      return false;
    }
  }

  private processField(
    element: HTMLElement,
    type: DetectedField['type'],
    fields: DetectedField[]
  ): void {
    // Skip hidden or very small elements
    const rect = element.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const id = this.generateFieldId(element);
    const label = this.findFieldLabel(element);
    const value = this.getFieldValue(element, type);
    const { fieldType, confidence } = this.categorizeField(element, label);

    const field: DetectedField = {
      id,
      type,
      selector: this.generateSelector(element),
      label,
      value,
      fieldType,
      confidence,
      element
    };

    fields.push(field);
    this.detectedFields.set(id, field);
  }

  private generateFieldId(element: HTMLElement): string {
    if (element.id) return element.id;
    if (element.getAttribute('name')) return element.getAttribute('name')!;
    return `field_${Math.random().toString(36).substring(7)}`;
  }

  private findFieldLabel(element: HTMLElement): string {
    // Check for associated label element
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent?.trim() || '';
    }

    // Check parent label
    const parentLabel = element.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.textContent?.trim() || '';
      // Remove the input value from label text
      const value = this.getFieldValue(element, 'input');
      return labelText.replace(value, '').trim();
    }

    // Check placeholder
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder;

    // Check aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // Check preceding sibling text
    const prev = element.previousElementSibling;
    if (prev && prev.tagName !== 'INPUT') {
      return prev.textContent?.trim() || '';
    }

    // Check name attribute
    const name = element.getAttribute('name');
    if (name) {
      return name.replace(/[_-]/g, ' ').replace(/([A-Z])/g, ' $1').trim();
    }

    return '';
  }

  private getFieldValue(element: HTMLElement, type: string): string {
    if (type === 'contenteditable') {
      return element.textContent?.trim() || '';
    }
    return (element as HTMLInputElement).value || '';
  }

  private generateSelector(element: HTMLElement): string {
    if (element.id) return `#${element.id}`;

    const path: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = `#${current.id}`;
        path.unshift(selector);
        break;
      }

      if (current.className) {
        const classes = current.className.split(' ').filter(c => c.trim());
        if (classes.length) {
          selector += `.${classes.slice(0, 2).join('.')}`;
        }
      }

      const parent: HTMLElement | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c: Element) => c.tagName === current!.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = parent;
    }

    return path.join(' > ');
  }

  private categorizeField(
    element: HTMLElement,
    label: string
  ): { fieldType: FieldCategory; confidence: number } {
    const searchText = [
      label,
      element.getAttribute('name') || '',
      element.getAttribute('placeholder') || '',
      element.id || ''
    ].join(' ').toLowerCase();

    for (const [category, patterns] of Object.entries(FIELD_PATTERNS)) {
      if (category === 'other') continue;

      for (const pattern of patterns) {
        if (pattern.test(searchText)) {
          return {
            fieldType: category as FieldCategory,
            confidence: 0.8
          };
        }
      }
    }

    return { fieldType: 'other', confidence: 0.3 };
  }

  private extractPatientInfoFromContent(): PatientInfo | null {
    const bodyText = document.body.innerText;

    // Pattern matching for patient name and MRN
    const mrnMatch = bodyText.match(/(?:MRN|Medical Record|Patient ID)[:\s]*([A-Z0-9-]+)/i);
    const nameMatch = bodyText.match(/(?:Patient|Name)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/);

    if (mrnMatch || nameMatch) {
      return {
        name: nameMatch?.[1] || 'Unknown',
        mrn: mrnMatch?.[1] || ''
      };
    }

    return null;
  }

  private setupMutationObserver(): void {
    // Watch for DOM changes that might add new form fields
    this.observer = new MutationObserver((mutations) => {
      let shouldRescan = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (
                node.tagName === 'INPUT' ||
                node.tagName === 'TEXTAREA' ||
                node.tagName === 'SELECT' ||
                node.querySelector('input, textarea, select')
              ) {
                shouldRescan = true;
                break;
              }
            }
          }
        }
      }

      if (shouldRescan) {
        console.log('[DOMMapper] DOM changed, rescanning fields...');
        this.bridge.emit('fields-changed', {});
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.detectedFields.clear();
  }
}
