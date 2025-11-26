/**
 * LLM Provider (PATH - Chat Agent)
 *
 * Simple wrapper for OpenAI GPT-4 class models.
 * Provides clinical assistant functionality per CNS OpenSpec.
 *
 * Context model:
 * - Transcript from current encounter only
 * - Patient context (from DOM/DB)
 * - Short rolling chat history (last 10-15 turns)
 * - NO historical visits or full-chart context
 */

import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PatientContext {
  name?: string;
  dob?: string;
  sex?: string;
  reason?: string;
  mrn?: string;
}

export interface AssistRequest {
  question: string;
  transcriptId?: number;
  transcript?: string;
  patientContext?: PatientContext;
  threadId?: string;
  chatHistory?: ChatMessage[];
}

export interface AssistResponse {
  answer: string;
  metadata: {
    tokens: number;
    model: string;
    threadId?: string;
  };
}

// In-memory chat history per thread (simple implementation)
const chatHistories: Map<string, ChatMessage[]> = new Map();
const MAX_HISTORY_LENGTH = 15;

/**
 * Clinical Assistant System Prompt
 * Per CNS OpenSpec: must not invent diagnoses, only summarize/suggest/structure
 */
const SYSTEM_PROMPT = `You are a clinical assistant helping a doctor draft and clarify notes.

Your role:
- Summarize, suggest, and structure content based on the transcript and patient info provided
- Help with billing points, documentation, and clinical summary
- Answer questions about the current encounter

You must NOT:
- Invent or suggest diagnoses that aren't mentioned in the transcript
- Override or contradict clinician decisions
- Provide medical advice beyond what's documented

Return structured text suitable for copy/paste into clinical notes when appropriate.`;

/**
 * LLM Provider class
 */
export class LLMProvider {
  private client: OpenAI | null = null;
  private model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_GPT4_MODEL || 'gpt-4o';

    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      console.log(`[LLM] Initialized with model: ${this.model}`);
    } else {
      console.warn('[LLM] OPENAI_API_KEY not set - chat assist will return placeholder responses');
    }
  }

  /**
   * Check if LLM is available
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Process an assist request
   */
  async assist(request: AssistRequest): Promise<AssistResponse> {
    const { question, transcript, patientContext, threadId } = request;

    // Build context message
    let contextMessage = '';

    if (patientContext) {
      contextMessage += '\nPatient Context:\n';
      if (patientContext.name) contextMessage += `- Name: ${patientContext.name}\n`;
      if (patientContext.dob) contextMessage += `- DOB: ${patientContext.dob}\n`;
      if (patientContext.sex) contextMessage += `- Sex: ${patientContext.sex}\n`;
      if (patientContext.reason) contextMessage += `- Chief Complaint: ${patientContext.reason}\n`;
      if (patientContext.mrn) contextMessage += `- MRN: ${patientContext.mrn}\n`;
    }

    if (transcript) {
      contextMessage += '\nTranscript:\n' + transcript.substring(0, 8000); // Limit context
      if (transcript.length > 8000) {
        contextMessage += '\n[...transcript truncated for length...]';
      }
    }

    // Get or create chat history for thread
    const historyKey = threadId || 'default';
    let history = chatHistories.get(historyKey) || [];

    // Build messages array
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add context as first user message if present
    if (contextMessage) {
      messages.push({ role: 'user', content: `Context for this encounter:${contextMessage}` });
      messages.push({ role: 'assistant', content: 'I understand. I have the patient context and transcript. How can I help?' });
    }

    // Add chat history
    messages.push(...history);

    // Add current question
    messages.push({ role: 'user', content: question });

    // If no OpenAI client, return placeholder
    if (!this.client) {
      const placeholderAnswer = `[LLM not configured] Your question was: "${question}"\n\nTo enable AI assistance, set OPENAI_API_KEY in your environment.`;

      return {
        answer: placeholderAnswer,
        metadata: {
          tokens: 0,
          model: 'placeholder',
          threadId: historyKey
        }
      };
    }

    try {
      // Call OpenAI
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.7,
        max_tokens: 1000
      });

      const answer = completion.choices[0]?.message?.content || 'No response generated.';
      const tokensUsed = completion.usage?.total_tokens || 0;

      // Update chat history
      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: answer });

      // Trim history if too long
      if (history.length > MAX_HISTORY_LENGTH * 2) {
        history = history.slice(-MAX_HISTORY_LENGTH * 2);
      }
      chatHistories.set(historyKey, history);

      return {
        answer,
        metadata: {
          tokens: tokensUsed,
          model: this.model,
          threadId: historyKey
        }
      };
    } catch (error: any) {
      console.error('[LLM] Error calling OpenAI:', error.message);
      throw new Error(`LLM error: ${error.message}`);
    }
  }

  /**
   * Clear chat history for a thread
   */
  clearHistory(threadId: string): void {
    chatHistories.delete(threadId);
  }
}

// Singleton instance
let llmProvider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (!llmProvider) {
    llmProvider = new LLMProvider();
  }
  return llmProvider;
}

export default LLMProvider;
