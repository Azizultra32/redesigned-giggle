/**
 * PATH Q: Full Lifecycle Orchestrator
 *
 * Coordinates the complete flow:
 * Record → Transcribe → Summary → Smart Fill
 *
 * State Machine:
 *   IDLE → RECORDING → TRANSCRIBING → SUMMARIZING → READY_TO_FILL → FILLED → IDLE
 */

import { EventEmitter } from 'events';

export type LifecycleState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'summarizing'
  | 'ready_to_fill'
  | 'filling'
  | 'completed'
  | 'error';

export interface LifecycleContext {
  sessionId: string;
  transcriptId: number | null;
  patientCode: string | null;
  doctorId: string | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  transcript: string;
  chunks: TranscriptChunk[];
  summary: Summary | null;
  fillPlan: FillPlan | null;
}

export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  wordCount: number;
}

export interface Summary {
  chiefComplaint: string;
  hpi: string;
  ros: Record<string, string>;
  assessment: string;
  plan: string[];
  medications: string[];
  followUp: string;
}

export interface FillPlan {
  fields: FillField[];
  generated: number;
}

export interface FillField {
  selector: string;
  label: string;
  value: string;
  filled: boolean;
}

export interface LifecycleEvents {
  'state:change': (state: LifecycleState, prev: LifecycleState) => void;
  'transcript:update': (text: string, isFinal: boolean) => void;
  'summary:ready': (summary: Summary) => void;
  'fill:ready': (plan: FillPlan) => void;
  'fill:complete': (results: FillResult[]) => void;
  'error': (error: Error, state: LifecycleState) => void;
}

export interface FillResult {
  selector: string;
  success: boolean;
  error?: string;
}

export class LifecycleOrchestrator extends EventEmitter {
  private state: LifecycleState = 'idle';
  private context: LifecycleContext;

  constructor(sessionId: string) {
    super();
    this.context = this.createContext(sessionId);
  }

  private createContext(sessionId: string): LifecycleContext {
    return {
      sessionId,
      transcriptId: null,
      patientCode: null,
      doctorId: null,
      startedAt: 0,
      completedAt: null,
      error: null,
      transcript: '',
      chunks: [],
      summary: null,
      fillPlan: null
    };
  }

  public getState(): LifecycleState {
    return this.state;
  }

  public getContext(): Readonly<LifecycleContext> {
    return { ...this.context };
  }

  private transition(to: LifecycleState): void {
    const from = this.state;
    if (!this.isValidTransition(from, to)) {
      console.warn(`Invalid transition: ${from} → ${to}`);
      return;
    }
    this.state = to;
    this.emit('state:change', to, from);
  }

  private isValidTransition(from: LifecycleState, to: LifecycleState): boolean {
    const transitions: Record<LifecycleState, LifecycleState[]> = {
      'idle': ['recording', 'error'],
      'recording': ['transcribing', 'idle', 'error'],
      'transcribing': ['summarizing', 'idle', 'error'],
      'summarizing': ['ready_to_fill', 'idle', 'error'],
      'ready_to_fill': ['filling', 'idle', 'error'],
      'filling': ['completed', 'error'],
      'completed': ['idle'],
      'error': ['idle']
    };
    return transitions[from]?.includes(to) ?? false;
  }

  // ─────────────────────────────────────────────
  // Stage 1: Recording
  // ─────────────────────────────────────────────

  public startRecording(doctorId: string, patientCode?: string): void {
    if (this.state !== 'idle') {
      this.emit('error', new Error('Cannot start recording: not idle'), this.state);
      return;
    }

    this.context = this.createContext(this.context.sessionId);
    this.context.doctorId = doctorId;
    this.context.patientCode = patientCode || `PT-${Date.now()}`;
    this.context.startedAt = Date.now();

    this.transition('recording');
  }

  public stopRecording(): void {
    if (this.state !== 'recording') {
      return;
    }
    this.transition('transcribing');
  }

  // ─────────────────────────────────────────────
  // Stage 2: Transcription
  // ─────────────────────────────────────────────

  public addTranscript(text: string, isFinal: boolean, chunk?: TranscriptChunk): void {
    if (this.state !== 'recording' && this.state !== 'transcribing') {
      return;
    }

    if (isFinal) {
      this.context.transcript += (this.context.transcript ? ' ' : '') + text;
    }

    if (chunk) {
      this.context.chunks.push(chunk);
    }

    this.emit('transcript:update', text, isFinal);
  }

  public setTranscriptId(id: number): void {
    this.context.transcriptId = id;
  }

  public finalizeTranscription(): void {
    if (this.state !== 'transcribing') {
      return;
    }
    this.transition('summarizing');
  }

  // ─────────────────────────────────────────────
  // Stage 3: Summarization
  // ─────────────────────────────────────────────

  public setSummary(summary: Summary): void {
    if (this.state !== 'summarizing') {
      return;
    }

    this.context.summary = summary;
    this.emit('summary:ready', summary);
    this.transition('ready_to_fill');
  }

  public generateSummaryFromTranscript(): Summary {
    // Basic extraction - would be replaced by LLM in production
    const text = this.context.transcript.toLowerCase();

    return {
      chiefComplaint: this.extractSection(text, ['chief complaint', 'cc', 'presenting']),
      hpi: this.extractSection(text, ['history of present illness', 'hpi']),
      ros: this.extractROS(text),
      assessment: this.extractSection(text, ['assessment', 'diagnosis', 'impression']),
      plan: this.extractList(text, ['plan', 'treatment', 'management']),
      medications: this.extractList(text, ['medication', 'prescription', 'rx']),
      followUp: this.extractSection(text, ['follow up', 'follow-up', 'return'])
    };
  }

  private extractSection(text: string, keywords: string[]): string {
    for (const keyword of keywords) {
      const idx = text.indexOf(keyword);
      if (idx !== -1) {
        const end = text.indexOf('.', idx + keyword.length);
        if (end !== -1) {
          return text.slice(idx, end + 1).trim();
        }
      }
    }
    return '';
  }

  private extractROS(text: string): Record<string, string> {
    const systems = ['constitutional', 'heent', 'cardiovascular', 'respiratory',
                     'gi', 'musculoskeletal', 'neurological', 'psychiatric'];
    const ros: Record<string, string> = {};

    for (const system of systems) {
      if (text.includes(system)) {
        ros[system] = 'reviewed';
      }
    }
    return ros;
  }

  private extractList(text: string, keywords: string[]): string[] {
    const items: string[] = [];
    for (const keyword of keywords) {
      const idx = text.indexOf(keyword);
      if (idx !== -1) {
        const segment = text.slice(idx, idx + 200);
        const matches = segment.match(/\b[a-z]+\s+\d+\s*mg/gi);
        if (matches) {
          items.push(...matches);
        }
      }
    }
    return items;
  }

  // ─────────────────────────────────────────────
  // Stage 4: Smart Fill
  // ─────────────────────────────────────────────

  public setFillPlan(plan: FillPlan): void {
    if (this.state !== 'ready_to_fill') {
      return;
    }

    this.context.fillPlan = plan;
    this.emit('fill:ready', plan);
  }

  public generateFillPlan(domFields: Array<{ selector: string; label: string }>): FillPlan {
    const summary = this.context.summary;
    if (!summary) {
      return { fields: [], generated: Date.now() };
    }

    const fields: FillField[] = [];

    for (const field of domFields) {
      const label = field.label.toLowerCase();
      let value = '';

      if (label.includes('chief') || label.includes('cc')) {
        value = summary.chiefComplaint;
      } else if (label.includes('hpi') || label.includes('history')) {
        value = summary.hpi;
      } else if (label.includes('assessment') || label.includes('diagnosis')) {
        value = summary.assessment;
      } else if (label.includes('plan')) {
        value = summary.plan.join('; ');
      } else if (label.includes('medication') || label.includes('rx')) {
        value = summary.medications.join(', ');
      } else if (label.includes('follow')) {
        value = summary.followUp;
      }

      if (value) {
        fields.push({
          selector: field.selector,
          label: field.label,
          value,
          filled: false
        });
      }
    }

    return { fields, generated: Date.now() };
  }

  public startFilling(): void {
    if (this.state !== 'ready_to_fill') {
      return;
    }
    this.transition('filling');
  }

  public completeFilling(results: FillResult[]): void {
    if (this.state !== 'filling') {
      return;
    }

    // Update fill plan with results
    if (this.context.fillPlan) {
      for (const result of results) {
        const field = this.context.fillPlan.fields.find(f => f.selector === result.selector);
        if (field) {
          field.filled = result.success;
        }
      }
    }

    this.context.completedAt = Date.now();
    this.emit('fill:complete', results);
    this.transition('completed');
  }

  // ─────────────────────────────────────────────
  // Error & Reset
  // ─────────────────────────────────────────────

  public setError(error: Error): void {
    this.context.error = error.message;
    this.emit('error', error, this.state);
    this.transition('error');
  }

  public reset(): void {
    this.context = this.createContext(this.context.sessionId);
    this.transition('idle');
  }

  // ─────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────

  public toJSON(): object {
    return {
      state: this.state,
      context: this.context
    };
  }

  public static fromJSON(data: { state: LifecycleState; context: LifecycleContext }): LifecycleOrchestrator {
    const orchestrator = new LifecycleOrchestrator(data.context.sessionId);
    orchestrator.state = data.state;
    orchestrator.context = data.context;
    return orchestrator;
  }
}

export default LifecycleOrchestrator;
