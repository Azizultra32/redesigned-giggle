/**
 * PATH Z: Legacy Session Migration
 *
 * Handles:
 * - Migration from old session formats
 * - Transcript format upgrades
 * - Data normalization
 * - Backward compatibility
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { EventEmitter } from 'events';

export interface MigrationConfig {
  batchSize: number;
  dryRun: boolean;
  verbose: boolean;
}

const DEFAULT_CONFIG: MigrationConfig = {
  batchSize: 100,
  dryRun: false,
  verbose: true
};

export interface MigrationResult {
  success: boolean;
  processed: number;
  migrated: number;
  skipped: number;
  errors: MigrationError[];
  duration: number;
}

export interface MigrationError {
  id: number | string;
  error: string;
  data?: unknown;
}

export interface LegacyTranscript {
  id: number;
  user_id: string;
  transcript: string | null;
  transcript_chunk?: unknown;
  created_at: string;
  // Old format fields
  raw_transcript?: string;
  chunks?: Array<{
    text: string;
    start?: number;
    end?: number;
  }>;
  patient_id?: string;
  session_id?: string;
}

export interface ModernTranscript {
  id: number;
  user_id: string;
  transcript: string;
  transcript_chunk: TranscriptChunk[];
  patient_code: string;
  patient_uuid: string | null;
  language: string;
  created_at: string;
  completed_at: string | null;
  ai_summary: object | null;
  ai_short_summary: object | null;
  ai_interim_summaries: object[];
}

export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw?: Array<{ word: string; start: number; end: number }>;
}

export class MigrationManager extends EventEmitter {
  private supabase: SupabaseClient;
  private config: MigrationConfig;

  constructor(supabase: SupabaseClient, config: Partial<MigrationConfig> = {}) {
    super();
    this.supabase = supabase;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────
  // Main Migration
  // ─────────────────────────────────────────────

  public async migrateAll(): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      processed: 0,
      migrated: 0,
      skipped: 0,
      errors: [],
      duration: 0
    };

    try {
      this.emit('migration:start');

      // Get total count
      const { count } = await this.supabase
        .from('transcripts2')
        .select('id', { count: 'exact', head: true });

      const total = count || 0;
      this.emit('migration:total', total);

      let offset = 0;

      while (offset < total) {
        const batchResult = await this.migrateBatch(offset);

        result.processed += batchResult.processed;
        result.migrated += batchResult.migrated;
        result.skipped += batchResult.skipped;
        result.errors.push(...batchResult.errors);

        this.emit('migration:progress', {
          processed: result.processed,
          total,
          percent: Math.round((result.processed / total) * 100)
        });

        offset += this.config.batchSize;
      }

      result.success = result.errors.length === 0;

    } catch (err) {
      result.success = false;
      result.errors.push({
        id: 'global',
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }

    result.duration = Date.now() - startTime;
    this.emit('migration:complete', result);

    return result;
  }

  private async migrateBatch(offset: number): Promise<Omit<MigrationResult, 'success' | 'duration'>> {
    const result = {
      processed: 0,
      migrated: 0,
      skipped: 0,
      errors: [] as MigrationError[]
    };

    const { data: rows, error } = await this.supabase
      .from('transcripts2')
      .select('*')
      .range(offset, offset + this.config.batchSize - 1)
      .order('id', { ascending: true });

    if (error) {
      result.errors.push({ id: 'batch', error: error.message });
      return result;
    }

    for (const row of rows || []) {
      result.processed++;

      try {
        const needsMigration = this.needsMigration(row);

        if (!needsMigration) {
          result.skipped++;
          continue;
        }

        const migrated = this.migrateRecord(row);

        if (!this.config.dryRun) {
          await this.saveRecord(migrated);
        }

        result.migrated++;

        if (this.config.verbose) {
          this.emit('record:migrated', { id: row.id });
        }

      } catch (err) {
        result.errors.push({
          id: row.id,
          error: err instanceof Error ? err.message : 'Unknown error',
          data: row
        });
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Migration Logic
  // ─────────────────────────────────────────────

  private needsMigration(row: LegacyTranscript): boolean {
    // Check for legacy format indicators

    // 1. Has old-style chunks
    if (row.chunks && !row.transcript_chunk) {
      return true;
    }

    // 2. Has raw_transcript but no transcript
    if (row.raw_transcript && !row.transcript) {
      return true;
    }

    // 3. transcript_chunk is not an array or is empty but has transcript
    if (row.transcript && (!Array.isArray(row.transcript_chunk) || row.transcript_chunk.length === 0)) {
      return true;
    }

    // 4. Missing patient_code (legacy records might not have it)
    if (!row.patient_code) {
      return true;
    }

    return false;
  }

  private migrateRecord(legacy: LegacyTranscript): Partial<ModernTranscript> {
    const migrated: Partial<ModernTranscript> = {
      id: legacy.id
    };

    // Migrate transcript text
    if (!legacy.transcript && legacy.raw_transcript) {
      migrated.transcript = legacy.raw_transcript;
    } else if (!legacy.transcript && legacy.chunks) {
      migrated.transcript = legacy.chunks.map(c => c.text).join(' ');
    }

    // Migrate chunks to modern format
    if (legacy.chunks && !legacy.transcript_chunk) {
      migrated.transcript_chunk = this.migrateChunks(legacy.chunks);
    } else if (legacy.transcript && (!legacy.transcript_chunk || !Array.isArray(legacy.transcript_chunk))) {
      // Generate chunks from transcript
      migrated.transcript_chunk = this.generateChunksFromTranscript(legacy.transcript);
    }

    // Migrate patient info
    if (!legacy.patient_code) {
      if (legacy.patient_id) {
        migrated.patient_code = legacy.patient_id;
      } else if (legacy.session_id) {
        migrated.patient_code = `LEGACY-${legacy.session_id}`;
      } else {
        migrated.patient_code = `LEGACY-${legacy.id}`;
      }
    }

    // Set defaults
    if (!legacy.language) {
      migrated.language = 'en';
    }

    // Initialize empty arrays/objects if missing
    if (!legacy.ai_interim_summaries) {
      migrated.ai_interim_summaries = [];
    }

    return migrated;
  }

  private migrateChunks(oldChunks: Array<{ text: string; start?: number; end?: number }>): TranscriptChunk[] {
    return oldChunks.map((chunk, index) => ({
      speaker: 0, // Default speaker since old format didn't have diarization
      text: chunk.text,
      start: chunk.start ?? index * 10,
      end: chunk.end ?? (index + 1) * 10,
      word_count: chunk.text.split(/\s+/).length
    }));
  }

  private generateChunksFromTranscript(transcript: string): TranscriptChunk[] {
    // Split transcript into sentences
    const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [transcript];

    let currentTime = 0;
    const avgWordsPerSecond = 2.5;

    return sentences.map(sentence => {
      const text = sentence.trim();
      const wordCount = text.split(/\s+/).length;
      const duration = wordCount / avgWordsPerSecond;

      const chunk: TranscriptChunk = {
        speaker: 0,
        text,
        start: currentTime,
        end: currentTime + duration,
        word_count: wordCount
      };

      currentTime += duration;
      return chunk;
    });
  }

  private async saveRecord(record: Partial<ModernTranscript>): Promise<void> {
    const { id, ...data } = record;

    const { error } = await this.supabase
      .from('transcripts2')
      .update(data)
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to save record ${id}: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // Specific Migrations
  // ─────────────────────────────────────────────

  public async migratePatientCodes(): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      processed: 0,
      migrated: 0,
      skipped: 0,
      errors: [],
      duration: 0
    };

    try {
      // Find records without patient_code
      const { data: rows, error } = await this.supabase
        .from('transcripts2')
        .select('id, patient_id, session_id')
        .or('patient_code.is.null,patient_code.eq.');

      if (error) throw error;

      for (const row of rows || []) {
        result.processed++;

        const patientCode = row.patient_id ||
          (row.session_id ? `SESS-${row.session_id}` : `AUTO-${row.id}`);

        if (!this.config.dryRun) {
          const { error: updateError } = await this.supabase
            .from('transcripts2')
            .update({ patient_code: patientCode })
            .eq('id', row.id);

          if (updateError) {
            result.errors.push({ id: row.id, error: updateError.message });
            continue;
          }
        }

        result.migrated++;
      }

      result.success = result.errors.length === 0;

    } catch (err) {
      result.success = false;
      result.errors.push({
        id: 'global',
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  public async migrateChunkFormat(): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      processed: 0,
      migrated: 0,
      skipped: 0,
      errors: [],
      duration: 0
    };

    try {
      // Find records with old chunk format or missing chunks
      const { data: rows, error } = await this.supabase
        .from('transcripts2')
        .select('id, transcript, transcript_chunk, chunks')
        .not('transcript', 'is', null);

      if (error) throw error;

      for (const row of rows || []) {
        result.processed++;

        const hasModernChunks = Array.isArray(row.transcript_chunk) &&
          row.transcript_chunk.length > 0 &&
          row.transcript_chunk[0]?.speaker !== undefined;

        if (hasModernChunks) {
          result.skipped++;
          continue;
        }

        let newChunks: TranscriptChunk[];

        if (row.chunks && Array.isArray(row.chunks)) {
          newChunks = this.migrateChunks(row.chunks);
        } else if (row.transcript) {
          newChunks = this.generateChunksFromTranscript(row.transcript);
        } else {
          result.skipped++;
          continue;
        }

        if (!this.config.dryRun) {
          const { error: updateError } = await this.supabase
            .from('transcripts2')
            .update({ transcript_chunk: newChunks })
            .eq('id', row.id);

          if (updateError) {
            result.errors.push({ id: row.id, error: updateError.message });
            continue;
          }
        }

        result.migrated++;
      }

      result.success = result.errors.length === 0;

    } catch (err) {
      result.success = false;
      result.errors.push({
        id: 'global',
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  // ─────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────

  public async validateAll(): Promise<ValidationResult> {
    const result: ValidationResult = {
      total: 0,
      valid: 0,
      invalid: 0,
      issues: []
    };

    const { data: rows, error } = await this.supabase
      .from('transcripts2')
      .select('id, transcript, transcript_chunk, patient_code, user_id');

    if (error) {
      result.issues.push({ id: 'query', issue: error.message });
      return result;
    }

    for (const row of rows || []) {
      result.total++;
      const issues: string[] = [];

      if (!row.user_id) {
        issues.push('Missing user_id');
      }

      if (!row.patient_code) {
        issues.push('Missing patient_code');
      }

      if (!row.transcript && (!row.transcript_chunk || row.transcript_chunk.length === 0)) {
        issues.push('No transcript content');
      }

      if (row.transcript_chunk && Array.isArray(row.transcript_chunk)) {
        for (let i = 0; i < row.transcript_chunk.length; i++) {
          const chunk = row.transcript_chunk[i];
          if (typeof chunk.speaker !== 'number') {
            issues.push(`Chunk ${i}: invalid speaker`);
          }
          if (typeof chunk.text !== 'string') {
            issues.push(`Chunk ${i}: invalid text`);
          }
        }
      }

      if (issues.length > 0) {
        result.invalid++;
        result.issues.push({ id: row.id, issue: issues.join('; ') });
      } else {
        result.valid++;
      }
    }

    return result;
  }
}

export interface ValidationResult {
  total: number;
  valid: number;
  invalid: number;
  issues: Array<{ id: number | string; issue: string }>;
}

export default MigrationManager;
