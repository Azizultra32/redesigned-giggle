/**
 * Patient Utilities
 *
 * Patient code and UUID management for transcripts.
 * AssistMD encounter ID format: ENC-YYYY-XXXXX
 */

export interface PatientInfo {
  patientCode: string;
  patientUuid?: string;
  patientTag?: number;
}

/**
 * Validate patient code format
 * Expected: ENC-YYYY-XXXXX or custom identifier
 */
export function validatePatientCode(code: string): boolean {
  if (!code || code.trim() === '') return false;

  // Allow standard ENC format
  const encFormat = /^ENC-\d{4}-\d{5}$/;
  if (encFormat.test(code)) return true;

  // Allow alphanumeric with hyphens (custom IDs)
  const customFormat = /^[A-Za-z0-9-_]+$/;
  return customFormat.test(code) && code.length >= 3 && code.length <= 50;
}

/**
 * Validate UUID format
 */
export function validateUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Generate a patient code for testing/demo (ENC format)
 */
export function generateDemoPatientCode(): string {
  const year = new Date().getFullYear();
  const sequence = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return `ENC-${year}-${sequence}`;
}

/**
 * Generate a patient code (PT format per contract)
 * Format: PT-<base36 timestamp>-<4 hex chars>
 */
export function generatePatientCode(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(16).substring(2, 6);
  return `PT-${timestamp}-${random}`;
}

/**
 * Parse patient info from request
 */
export function parsePatientInfo(data: any): PatientInfo | null {
  if (!data) return null;

  const patientCode = data.patientCode || data.patient_code;
  const patientUuid = data.patientUuid || data.patient_uuid;
  const patientTag = data.patientTag || data.patient_tag || 0;

  if (!patientCode) return null;

  if (!validatePatientCode(patientCode)) {
    throw new Error(`Invalid patient code format: ${patientCode}`);
  }

  if (patientUuid && !validateUuid(patientUuid)) {
    throw new Error(`Invalid patient UUID format: ${patientUuid}`);
  }

  return {
    patientCode,
    patientUuid: patientUuid || undefined,
    patientTag: typeof patientTag === 'number' ? patientTag : 0
  };
}

/**
 * Sanitize patient info for storage (remove PII if needed)
 */
export function sanitizePatientInfo(info: PatientInfo): PatientInfo {
  return {
    patientCode: info.patientCode.trim(),
    patientUuid: info.patientUuid?.trim(),
    patientTag: info.patientTag || 0
  };
}
