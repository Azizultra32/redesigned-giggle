/**
 * ChunkAssembler - Aggregates Deepgram word-level results into speaker chunks
 * 
 * Aggregation Rules:
 * 1. Group words by speaker (0, 1, 2...)
 * 2. Break into new chunk if:
 *    - Speaker changes, OR
 *    - Time gap > maxDurationSeconds from chunk start
 * 3. Preserve word-level data in raw[] field
 */

import { WordResult, TranscriptChunk } from '../types/index.js';

export interface ChunkAssemblerConfig {
  maxDurationSeconds: number; // Max chunk duration (30s recommended)
  onChunkComplete: (chunk: TranscriptChunk) => void;
}

export class ChunkAssembler {
  private config: ChunkAssemblerConfig;
  private currentChunk: {
    speaker: number;
    words: WordResult[];
    startTime: number;
  } | null = null;

  constructor(config: ChunkAssemblerConfig) {
    this.config = config;
  }

  /**
   * Add words from a Deepgram final transcript
   */
  addWords(words: WordResult[]): void {
    if (!words || words.length === 0) return;

    for (const word of words) {
      this.addWord(word);
    }
  }

  /**
   * Add a single word to the assembler
   */
  private addWord(word: WordResult): void {
    // If no current chunk, start a new one
    if (!this.currentChunk) {
      this.currentChunk = {
        speaker: word.speaker,
        words: [word],
        startTime: word.start
      };
      return;
    }

    // Check if we should finalize the current chunk
    const shouldFinalize =
      word.speaker !== this.currentChunk.speaker || // Speaker changed
      (word.start - this.currentChunk.startTime) > this.config.maxDurationSeconds; // Duration exceeded

    if (shouldFinalize) {
      this.finalizeCurrentChunk();
      this.currentChunk = {
        speaker: word.speaker,
        words: [word],
        startTime: word.start
      };
    } else {
      // Add word to current chunk
      this.currentChunk.words.push(word);
    }
  }

  /**
   * Force flush the current chunk (call on utterance end or disconnect)
   */
  forceFlush(): void {
    if (this.currentChunk && this.currentChunk.words.length > 0) {
      this.finalizeCurrentChunk();
    }
  }

  /**
   * Finalize the current chunk and emit it
   */
  private finalizeCurrentChunk(): void {
    if (!this.currentChunk || this.currentChunk.words.length === 0) return;

    const words = this.currentChunk.words;
    const text = words.map(w => w.word).join(' ');
    const start = words[0].start;
    const end = words[words.length - 1].end;

    const chunk: TranscriptChunk = {
      speaker: this.currentChunk.speaker,
      text,
      start,
      end,
      word_count: words.length,
      raw: words
    };

    this.config.onChunkComplete(chunk);
    this.currentChunk = null;
  }
}
