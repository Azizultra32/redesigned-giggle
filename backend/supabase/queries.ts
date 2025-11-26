/**
 * Supabase Queries
 *
 * All database operations for transcripts2 table.
 * PRODUCTION SCHEMA: Chunks stored in transcript_chunk jsonb[] array.
 */

import { getSupabaseClient } from './client.js';

/**
 * Chunk object stored in transcript_chunk jsonb[]
 */
export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
    speaker: number;
  }>;
}

/**
 * Create a new transcript run
 * @returns BIGINT id of created row
 */
export async function createTranscriptRun(
  userId: string,
  patientCode?: string,
  patientUuid?: string
): Promise<number> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('transcripts2')
    .insert({
      user_id: userId,
      patient_code: patientCode || '',
      patient_uuid: patientUuid || null,
      language: 'en',
      transcript_chunk: [],
      ai_interim_summaries: []
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Supabase] createTranscriptRun failed:', error);
    throw error;
  }

  console.log(`[Supabase] Created transcript run: ${data.id}`);
  return data.id;
}

/**
 * Save transcript chunks (append to transcript_chunk jsonb[])
 * Also rebuilds the flattened transcript text
 */
export async function saveTranscriptChunks(
  transcriptId: number,
  chunks: TranscriptChunk[]
): Promise<void> {
  const client = getSupabaseClient();

  // Fetch existing chunks
  const { data: existing, error: fetchError } = await client
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', transcriptId)
    .single();

  if (fetchError) {
    console.error('[Supabase] Failed to fetch existing chunks:', fetchError);
    throw fetchError;
  }

  // Append new chunks
  const existingChunks: TranscriptChunk[] = existing?.transcript_chunk || [];
  const updatedChunks = [...existingChunks, ...chunks];

  // Rebuild full transcript text
  const fullTranscript = updatedChunks
    .map((c) => `[Speaker ${c.speaker}]: ${c.text}`)
    .join('\n');

  // Update transcript
  const { error: updateError } = await client
    .from('transcripts2')
    .update({
      transcript_chunk: updatedChunks,
      transcript: fullTranscript
    })
    .eq('id', transcriptId);

  if (updateError) {
    console.error('[Supabase] Failed to save chunks:', updateError);
    throw updateError;
  }

  console.log(`[Supabase] Saved ${chunks.length} chunks to transcript ${transcriptId}`);
}

/**
 * Update transcript run (mark complete)
 */
export async function updateTranscriptRun(transcriptId: number): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client
    .from('transcripts2')
    .update({
      completed_at: new Date().toISOString()
    })
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to complete transcript run:', error);
    throw error;
  }

  console.log(`[Supabase] Completed transcript run: ${transcriptId}`);
}

/**
 * Update patient info on transcript
 */
export async function updatePatientInfo(
  transcriptId: number,
  patientCode: string,
  patientUuid?: string
): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client
    .from('transcripts2')
    .update({
      patient_code: patientCode,
      patient_uuid: patientUuid || null
    })
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to update patient info:', error);
    throw error;
  }
}

/**
 * Get full transcript text
 */
export async function getFullTranscript(transcriptId: number): Promise<string> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('transcript')
    .eq('id', transcriptId)
    .single();

  if (error) {
    console.error('[Supabase] Failed to get transcript:', error);
    throw error;
  }

  return data?.transcript || '';
}

/**
 * Get transcript chunks
 */
export async function getChunks(transcriptId: number): Promise<TranscriptChunk[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', transcriptId)
    .single();

  if (error) {
    console.error('[Supabase] Failed to get chunks:', error);
    throw error;
  }

  return data?.transcript_chunk || [];
}

/**
 * Get latest transcript for a user
 */
export async function getLatestTranscript(userId: string) {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('id, patient_code, patient_uuid, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[Supabase] Failed to get latest transcript:', error);
    throw error;
  }

  return data;
}

/**
 * Save AI interim summary
 */
export async function saveInterimSummary(
  transcriptId: number,
  summary: object
): Promise<void> {
  const client = getSupabaseClient();

  // Get existing summaries
  const { data: existing } = await client
    .from('transcripts2')
    .select('ai_interim_summaries')
    .eq('id', transcriptId)
    .single();

  const summaries = existing?.ai_interim_summaries || [];
  summaries.push(summary);

  const { error } = await client
    .from('transcripts2')
    .update({ ai_interim_summaries: summaries })
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to save interim summary:', error);
    throw error;
  }
}

/**
 * Get latest transcript profile (matches contract specification)
 */
export async function latestTranscriptProfile(): Promise<{
  id: number | null;
  patient_code: string | null;
  patient_uuid: string | null;
  transcript: string | null;
  created_at: string | null;
  completed_at: string | null;
}> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('id, patient_code, patient_uuid, transcript, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[Supabase] Failed to get latest transcript profile:', error);
    return {
      id: null,
      patient_code: null,
      patient_uuid: null,
      transcript: null,
      created_at: null,
      completed_at: null
    };
  }

  return {
    id: data?.id ?? null,
    patient_code: data?.patient_code ?? null,
    patient_uuid: data?.patient_uuid ?? null,
    transcript: data?.transcript ?? null,
    created_at: data?.created_at ?? null,
    completed_at: data?.completed_at ?? null
  };
}

/**
 * Mark transcript as completed
 */
export async function markTranscriptCompleted(id: number): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client
    .from('transcripts2')
    .update({
      completed_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) {
    console.error('[Supabase] Failed to mark transcript completed:', error);
    throw error;
  }

  console.log(`[Supabase] Marked transcript ${id} as completed`);
}

/**
 * Get a specific transcript by ID
 */
export async function getTranscriptById(id: number) {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[Supabase] Failed to get transcript:', error);
    throw error;
  }

  return data;
}

/**
 * Save AI summary to transcript
 */
export async function saveSummary(
  transcriptId: number,
  summary: object,
  shortSummary?: object
): Promise<void> {
  const client = getSupabaseClient();

  const updateData: Record<string, unknown> = {
    ai_summary: summary,
    processed_at: new Date().toISOString()
  };

  if (shortSummary) {
    updateData.ai_short_summary = shortSummary;
  }

  const { error } = await client
    .from('transcripts2')
    .update(updateData)
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to save summary:', error);
    throw error;
  }

  console.log(`[Supabase] Saved summary to transcript ${transcriptId}`);
}
