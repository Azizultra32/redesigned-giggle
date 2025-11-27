/**
 * DOM Reader
 *
 * Extracts patient context and clinical data from EHR pages.
 * Handles different EHR layouts and structures.
 */

import { Page } from 'playwright';
import {
  DomSnapshot,
  ExtractedPatientContext,
  DetectedField,
  EhrType
} from './types.js';
import { FieldDetector } from './detector.js';

// Patient data extraction patterns
const PATIENT_PATTERNS = {
  name: [
    /patient\s*name[:\s]+([^\n,]+)/i,
    /name[:\s]+([^\n,]+)/i,
    /pt[:\s]+([^\n,]+)/i
  ],
  mrn: [
    /mrn[:\s#]+(\w+)/i,
    /medical\s*record[:\s#]+(\w+)/i,
    /patient\s*id[:\s#]+(\w+)/i,
    /chart\s*#?[:\s]+(\w+)/i
  ],
  dob: [
    /dob[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /date\s*of\s*birth[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /birth\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  ],
  gender: [
    /sex[:\s]+(\w+)/i,
    /gender[:\s]+(\w+)/i
  ],
  age: [
    /age[:\s]+(\d+)\s*(?:y|yr|year)?/i,
    /(\d+)\s*(?:y\.?o\.?|years?\s*old)/i
  ]
};

// EHR-specific selectors for patient banner
const EHR_SELECTORS: Record<EhrType, { banner?: string; name?: string; mrn?: string; dob?: string }> = {
  epic: {
    banner: '.patient-banner, .patientbanner, [data-testid="patient-banner"]',
    name: '.patient-name, .patientname',
    mrn: '.mrn, .patient-mrn',
    dob: '.dob, .patient-dob'
  },
  cerner: {
    banner: '.patient-header, .patient-identification',
    name: '.patient-full-name',
    mrn: '.patient-identifier',
    dob: '.patient-birth-date'
  },
  allscripts: {
    banner: '.patient-demographics',
    name: '.patient-name-field',
    mrn: '.patient-account-number',
    dob: '.patient-dob-field'
  },
  athena: {
    banner: '.PatientHeader',
    name: '.PatientName',
    mrn: '.PatientMRN',
    dob: '.PatientDOB'
  },
  meditech: {
    banner: '.patientDemographics',
    name: '.ptName',
    mrn: '.ptMRN',
    dob: '.ptDOB'
  },
  nextgen: {
    banner: '.patient-info-banner',
    name: '.patient-name',
    mrn: '.patient-mrn',
    dob: '.patient-dob'
  },
  eclinicalworks: {
    banner: '.patient-header-container',
    name: '.patient-name',
    mrn: '.patient-id',
    dob: '.patient-birthdate'
  },
  unknown: {}
};

export class DomReader {
  private page: Page;
  private detector: FieldDetector;
  private ehrType: EhrType;

  constructor(page: Page, detector: FieldDetector, ehrType: EhrType = 'unknown') {
    this.page = page;
    this.detector = detector;
    this.ehrType = ehrType;
  }

  /**
   * Create a full DOM snapshot including fields and patient context
   */
  async createSnapshot(): Promise<DomSnapshot> {
    const url = this.page.url();
    const fields = await this.detector.detectFields();
    const patientContext = await this.extractPatientContext();

    return {
      id: `snapshot_${Date.now()}`,
      url,
      timestamp: Date.now(),
      fields,
      patientContext,
      ehrType: this.ehrType
    };
  }

  /**
   * Extract patient context from the page
   */
  async extractPatientContext(): Promise<ExtractedPatientContext> {
    const context: ExtractedPatientContext = {};

    // Try EHR-specific extraction first
    const ehrContext = await this.extractFromEhrSelectors();
    Object.assign(context, ehrContext);

    // Fall back to pattern-based extraction
    if (!context.name || !context.mrn) {
      const patternContext = await this.extractFromPatterns();
      context.name = context.name || patternContext.name;
      context.mrn = context.mrn || patternContext.mrn;
      context.dob = context.dob || patternContext.dob;
      context.gender = context.gender || patternContext.gender;
      context.age = context.age || patternContext.age;
    }

    // Extract clinical data
    const clinicalData = await this.extractClinicalData();
    Object.assign(context, clinicalData);

    return context;
  }

  /**
   * Extract patient data using EHR-specific selectors
   */
  private async extractFromEhrSelectors(): Promise<ExtractedPatientContext> {
    const context: ExtractedPatientContext = {};
    const selectors = EHR_SELECTORS[this.ehrType];

    if (!selectors || Object.keys(selectors).length === 0) {
      return context;
    }

    try {
      if (selectors.name) {
        const nameEl = await this.page.$(selectors.name);
        if (nameEl) {
          context.name = await nameEl.textContent() || undefined;
          context.name = context.name?.trim();
        }
      }

      if (selectors.mrn) {
        const mrnEl = await this.page.$(selectors.mrn);
        if (mrnEl) {
          context.mrn = await mrnEl.textContent() || undefined;
          context.mrn = this.extractNumber(context.mrn);
        }
      }

      if (selectors.dob) {
        const dobEl = await this.page.$(selectors.dob);
        if (dobEl) {
          context.dob = await dobEl.textContent() || undefined;
          context.dob = this.extractDate(context.dob);
        }
      }
    } catch {
      // Selectors didn't match, fall through to pattern extraction
    }

    return context;
  }

  /**
   * Extract patient data using regex patterns on page text
   */
  private async extractFromPatterns(): Promise<ExtractedPatientContext> {
    const context: ExtractedPatientContext = {};

    try {
      // Get visible text from the page header area
      const headerText = await this.page.evaluate(() => {
        // Try to find patient banner/header area
        const bannerSelectors = [
          '.patient-banner',
          '.patient-header',
          'header',
          '[role="banner"]',
          '.demographics',
          '.patient-info'
        ];

        for (const selector of bannerSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            return el.textContent.slice(0, 2000); // Limit text size
          }
        }

        // Fall back to top portion of body
        return document.body.textContent?.slice(0, 3000) || '';
      });

      // Extract name
      for (const pattern of PATIENT_PATTERNS.name) {
        const match = headerText.match(pattern);
        if (match && match[1]) {
          context.name = match[1].trim();
          break;
        }
      }

      // Extract MRN
      for (const pattern of PATIENT_PATTERNS.mrn) {
        const match = headerText.match(pattern);
        if (match && match[1]) {
          context.mrn = match[1].trim();
          break;
        }
      }

      // Extract DOB
      for (const pattern of PATIENT_PATTERNS.dob) {
        const match = headerText.match(pattern);
        if (match && match[1]) {
          context.dob = match[1].trim();
          break;
        }
      }

      // Extract gender
      for (const pattern of PATIENT_PATTERNS.gender) {
        const match = headerText.match(pattern);
        if (match && match[1]) {
          const gender = match[1].trim().toLowerCase();
          if (['male', 'female', 'm', 'f'].includes(gender)) {
            context.gender = gender === 'm' ? 'male' : gender === 'f' ? 'female' : gender;
            break;
          }
        }
      }

      // Extract age
      for (const pattern of PATIENT_PATTERNS.age) {
        const match = headerText.match(pattern);
        if (match && match[1]) {
          context.age = match[1].trim();
          break;
        }
      }
    } catch {
      // Pattern extraction failed
    }

    return context;
  }

  /**
   * Extract clinical data (allergies, medications, chief complaint)
   */
  private async extractClinicalData(): Promise<Partial<ExtractedPatientContext>> {
    const data: Partial<ExtractedPatientContext> = {};

    try {
      // Extract allergies
      data.allergies = await this.extractListData([
        '.allergies-list',
        '.allergy-list',
        '[data-section="allergies"]',
        '#allergies'
      ]);

      // Extract medications
      data.medications = await this.extractListData([
        '.medications-list',
        '.medication-list',
        '[data-section="medications"]',
        '#medications'
      ]);

      // Extract chief complaint
      const ccFields = this.detector.getFieldsByCategory('chief-complaint');
      if (ccFields.length > 0 && ccFields[0].value) {
        data.chiefComplaint = ccFields[0].value;
      }
    } catch {
      // Clinical data extraction failed
    }

    return data;
  }

  /**
   * Extract list data from common containers
   */
  private async extractListData(selectors: string[]): Promise<string[] | undefined> {
    for (const selector of selectors) {
      try {
        const items = await this.page.$$eval(selector + ' li, ' + selector + ' .item', (elements) => {
          return elements
            .map(el => el.textContent?.trim())
            .filter((text): text is string => Boolean(text) && text.length > 0);
        });

        if (items.length > 0) {
          return items;
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  /**
   * Get specific text content from the page
   */
  async getTextContent(selector: string): Promise<string | null> {
    try {
      const element = await this.page.$(selector);
      if (!element) return null;
      return await element.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Get multiple text contents
   */
  async getMultipleTextContents(selector: string): Promise<string[]> {
    try {
      return await this.page.$$eval(selector, (elements) =>
        elements
          .map(el => el.textContent?.trim())
          .filter((text): text is string => Boolean(text))
      );
    } catch {
      return [];
    }
  }

  /**
   * Check if an element exists
   */
  async elementExists(selector: string): Promise<boolean> {
    try {
      const element = await this.page.$(selector);
      return element !== null;
    } catch {
      return false;
    }
  }

  /**
   * Wait for patient data to load
   */
  async waitForPatientData(timeout: number = 5000): Promise<boolean> {
    const selectors = EHR_SELECTORS[this.ehrType];
    if (!selectors?.banner) {
      // For unknown EHR, wait for any patient-related content
      return await this.page.waitForSelector(
        '.patient-banner, .patient-header, [data-patient], .demographics',
        { timeout, state: 'visible' }
      ).then(() => true).catch(() => false);
    }

    return await this.page.waitForSelector(selectors.banner, {
      timeout,
      state: 'visible'
    }).then(() => true).catch(() => false);
  }

  // ============================================
  // Utility Methods
  // ============================================

  private extractNumber(text?: string): string | undefined {
    if (!text) return undefined;
    const match = text.match(/\d+/);
    return match ? match[0] : undefined;
  }

  private extractDate(text?: string): string | undefined {
    if (!text) return undefined;
    const match = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
    return match ? match[0] : undefined;
  }

  /**
   * Update EHR type based on detected patterns
   */
  setEhrType(ehrType: EhrType): void {
    this.ehrType = ehrType;
  }
}
