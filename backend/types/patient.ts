/**
 * Patient Types
 *
 * Types related to patient information and context.
 */

/**
 * Patient information
 */
export interface PatientInfo {
  name?: string;
  dob?: string;
  mrn?: string;
  sex?: 'M' | 'F' | 'O';
  reason?: string;
}

/**
 * Patient context for LLM queries
 */
export interface PatientContext {
  name?: string;
  age?: number;
  sex?: string;
  chiefComplaint?: string;
  relevantHistory?: string;
}

/**
 * Patient card for overlay display
 */
export interface PatientCard {
  name: string;
  dob: string;
  mrn: string;
  sex: string;
  reason: string;
  sessionId: string | null;
  doctor: string;
  autopilotReady: boolean;
  lastTranscript: string | null;
}

/**
 * Patient profile from database
 */
export interface PatientProfile {
  id: number;
  patient_code: string;
  patient_uuid: string | null;
  transcript: string | null;
  completed_at: string | null;
}
