/**
 * Deepgram Consumer - AssistMD Truth Package
 * 
 * Real-time transcription with speaker diarization using ChunkAssembler.
 * Connects to Deepgram nova-2-medical streaming API.
 * 
 * Audio format: PCM 16kHz mono linear16
 * Diarization: Up to 50 speakers (0-49)
 */

import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
import { ChunkAssembler } from './chunk-assembler.js';
import { WordResult, TranscriptEvent, TranscriptChunk } from '../types/index.js';

export interface DeepgramConsumerConfig {
  onTranscript: (event: TranscriptEvent) => void;
  onChunk: (chunk: TranscriptChunk) => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export class DeepgramConsumer {
  private client: ReturnType<typeof createClient> | null = null;
  private connection: LiveClient | null = null;
  private config: DeepgramConsumerConfig;
  private chunkAssembler: ChunkAssembler;
  private isConnected = false;

  constructor(config: DeepgramConsumerConfig) {
    this.config = config;
    
    // Initialize ChunkAssembler with 30s max duration
    this.chunkAssembler = new ChunkAssembler({
      maxDurationSeconds: 30,
      onChunkComplete: (chunk) => {
        console.log(`[Deepgram] Chunk complete: Speaker ${chunk.speaker}, ${chunk.word_count} words, ${(chunk.end - chunk.start).toFixed(1)}s`);
        config.onChunk(chunk);
      }
    });
  }

  async connect(): Promise<void> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY environment variable not set');
    }

    console.log('[Deepgram] Connecting to streaming API...');
    this.client = createClient(apiKey);

    this.connection = this.client.listen.live({
      model: 'nova-2-medical', // Medical model for better clinical terminology
      language: 'en-US',
      smart_format: true,
      punctuate: true,
      diarize: true, // Enable speaker diarization
      interim_results: true,
      utterance_end_ms: 1000,
      vad_events: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Deepgram connection timeout (10s)'));
        }
      }, 10000);

      this.connection!.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(timeout);
        this.isConnected = true;
        console.log('[Deepgram] Connected to nova-2-medical model');
        resolve();
      });

      this.connection!.on(LiveTranscriptionEvents.Error, (error: Error) => {
        clearTimeout(timeout);
        console.error('[Deepgram] Error:', error);
        this.config.onError(error);
        if (!this.isConnected) reject(error);
      });

      this.connection!.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        this.handleTranscript(data);
      });

      this.connection!.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        console.log('[Deepgram] Utterance end - flushing chunk');
        this.chunkAssembler.forceFlush();
      });

      this.connection!.on(LiveTranscriptionEvents.Close, () => {
        console.log('[Deepgram] Connection closed');
        this.isConnected = false;
        this.chunkAssembler.forceFlush();
        this.config.onClose();
      });
    });
  }

  sendAudio(data: Buffer): void {
    if (this.connection && this.isConnected) {
      // Convert Buffer to ArrayBuffer for Deepgram SDK
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
      this.connection.send(arrayBuffer);
    }
  }

  disconnect(): void {
    if (this.connection) {
      console.log('[Deepgram] Disconnecting...');
      this.chunkAssembler.forceFlush();
      this.connection.finish();
      this.connection = null;
      this.isConnected = false;
    }
  }

  getConnectionState(): boolean {
    return this.isConnected;
  }

  private handleTranscript(data: any): void {
    const channel = data.channel;
    if (!channel?.alternatives?.length) return;

    const alternative = channel.alternatives[0];
    const text = alternative.transcript;

    if (!text || text.trim() === '') return;

    const words: WordResult[] = (alternative.words || []).map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      speaker: w.speaker ?? 0
    }));

    // Get dominant speaker from words
    const speaker = this.getDominantSpeaker(words);

    const event: TranscriptEvent = {
      type: data.is_final ? 'final' : 'interim',
      text,
      speaker,
      start: words[0]?.start ?? 0,
      end: words[words.length - 1]?.end ?? 0,
      confidence: alternative.confidence ?? 0,
      words,
      isFinal: data.is_final ?? false
    };

    // Send transcript event for real-time display
    this.config.onTranscript(event);

    // Feed to ChunkAssembler for aggregation (finals only)
    if (event.isFinal && data.speech_final) {
      console.log(`[Deepgram] Final transcript: "${text}" (speaker ${speaker})`);
      this.chunkAssembler.addWords(words);
    }
  }

  private getDominantSpeaker(words: WordResult[]): number {
    const counts: Record<number, number> = {};
    for (const word of words) {
      counts[word.speaker] = (counts[word.speaker] || 0) + 1;
    }

    let dominant = 0;
    let maxCount = 0;
    for (const [speaker, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        dominant = parseInt(speaker);
      }
    }
    return dominant;
  }
}
