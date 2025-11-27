/**
 * Playwright Orchestration Types
 *
 * Type definitions for browser automation, form detection,
 * and EHR field mapping.
 */

// ============================================
// Browser Connection
// ============================================

export interface BrowserConnection {
  id: string;
  wsEndpoint: string;
  isConnected: boolean;
  browserType: 'chromium' | 'firefox' | 'webkit';
  pageCount: number;
  createdAt: number;
  lastActivity: number;
}

export interface PageInfo {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
  ehrType?: EhrType;
}

export type EhrType =
  | 'epic'
  | 'cerner'
  | 'allscripts'
  | 'athena'
  | 'meditech'
  | 'nextgen'
  | 'eclinicalworks'
  | 'unknown';

// ============================================
// Form Field Detection
// ============================================

export interface DetectedField {
  id: string;
  selector: string;
  type: FieldType;
  label: string;
  value: string;
  isEditable: boolean;
  isVisible: boolean;
  boundingBox?: BoundingBox;
  confidence: number;
  category?: FieldCategory;
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'time'
  | 'number'
  | 'email'
  | 'phone'
  | 'rich-text'
  | 'contenteditable';

export type FieldCategory =
  | 'chief-complaint'
  | 'history-present-illness'
  | 'review-of-systems'
  | 'physical-exam'
  | 'assessment'
  | 'plan'
  | 'medications'
  | 'allergies'
  | 'vitals'
  | 'diagnosis'
  | 'procedure'
  | 'note'
  | 'unknown';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================
// Field Mapping
// ============================================

export interface FieldMapping {
  id: string;
  fieldSelector: string;
  transcriptSource: TranscriptSource;
  autoFill: boolean;
  transform?: TransformRule;
  createdAt: number;
}

export type TranscriptSource =
  | 'chief-complaint'
  | 'hpi'
  | 'ros'
  | 'physical-exam'
  | 'assessment'
  | 'plan'
  | 'full-transcript'
  | 'soap-subjective'
  | 'soap-objective'
  | 'soap-assessment'
  | 'soap-plan';

export interface TransformRule {
  type: 'format' | 'extract' | 'summarize' | 'template';
  options?: Record<string, unknown>;
}

// ============================================
// Auto-Fill Operations
// ============================================

export interface FillRequest {
  fieldId: string;
  selector: string;
  value: string;
  append?: boolean;
  confirm?: boolean;
}

export interface FillResult {
  fieldId: string;
  success: boolean;
  previousValue?: string;
  newValue?: string;
  error?: string;
}

export interface FillBatch {
  id: string;
  requests: FillRequest[];
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  results: FillResult[];
  createdAt: number;
  completedAt?: number;
}

// ============================================
// DOM Reading
// ============================================

export interface DomSnapshot {
  id: string;
  url: string;
  timestamp: number;
  fields: DetectedField[];
  patientContext?: ExtractedPatientContext;
  ehrType: EhrType;
}

export interface ExtractedPatientContext {
  name?: string;
  mrn?: string;
  dob?: string;
  gender?: string;
  age?: string;
  chiefComplaint?: string;
  allergies?: string[];
  medications?: string[];
}

// ============================================
// Orchestration Commands
// ============================================

export type OrchestratorCommand =
  | { kind: 'connect'; wsEndpoint: string }
  | { kind: 'disconnect' }
  | { kind: 'scan-page' }
  | { kind: 'detect-fields' }
  | { kind: 'map-field'; fieldId: string; source: TranscriptSource }
  | { kind: 'fill-field'; request: FillRequest }
  | { kind: 'fill-batch'; requests: FillRequest[] }
  | { kind: 'read-patient' }
  | { kind: 'undo-fill'; fieldId: string }
  | { kind: 'highlight-field'; fieldId: string }
  | { kind: 'clear-highlights' };

export interface OrchestratorState {
  connection: BrowserConnection | null;
  activePage: PageInfo | null;
  detectedFields: DetectedField[];
  mappings: FieldMapping[];
  pendingFills: FillBatch[];
  lastSnapshot: DomSnapshot | null;
  isScanning: boolean;
  error: string | null;
}

// ============================================
// Events
// ============================================

export type OrchestratorEvent =
  | { kind: 'connected'; connection: BrowserConnection }
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'page-changed'; page: PageInfo }
  | { kind: 'fields-detected'; fields: DetectedField[] }
  | { kind: 'field-filled'; result: FillResult }
  | { kind: 'patient-extracted'; context: ExtractedPatientContext }
  | { kind: 'error'; message: string; details?: unknown };
