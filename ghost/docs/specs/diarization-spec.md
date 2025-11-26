# Diarization Specification

## Overview

Speaker diarization identifies "who spoke when" in the transcript. GHOST-NEXT uses Deepgram's built-in diarization and aggregates results into chunks.

## Deepgram Configuration

```typescript
{
  diarize: true,
  model: 'nova-2',
  language: 'en-US'
}
```

### Speaker Assignment

Deepgram assigns speaker IDs (0-49) to each word:

```json
{
  "word": "Hello",
  "start": 0.0,
  "end": 0.4,
  "speaker": 0
}
```

### Speaker Mapping

| ID | Role |
|----|------|
| 0 | Provider (clinician) |
| 1 | Patient |
| 2+ | Additional participants |

## Chunk Aggregation

### Rules

Words are aggregated into chunks based on:

1. **Speaker Change**
   - New chunk when speaker ID changes
   - Preserves conversation flow

2. **Duration Limit (30 seconds)**
   - New chunk when duration > 30s
   - Prevents oversized chunks

3. **Utterance End**
   - New chunk on Deepgram `utterance_end` event
   - Marks natural pauses

### Algorithm

```typescript
class ChunkAggregator {
  private currentChunk: Chunk | null = null;
  private readonly maxDuration = 30; // seconds

  addWord(word: Word): void {
    if (!this.currentChunk) {
      this.startNewChunk(word);
      return;
    }

    const speakerChanged = word.speaker !== this.currentChunk.speaker;
    const durationExceeded = (word.end - this.currentChunk.start) > this.maxDuration;

    if (speakerChanged || durationExceeded) {
      this.flush();
      this.startNewChunk(word);
    } else {
      this.appendWord(word);
    }
  }

  forceFlush(): void {
    // Called on utterance_end or recording stop
    if (this.currentChunk) {
      this.emit(this.buildChunk());
      this.currentChunk = null;
    }
  }
}
```

## Chunk Format

```typescript
interface TranscriptChunk {
  speaker: number;      // 0 = Provider, 1+ = Patient
  text: string;         // Joined punctuated text
  start: number;        // Start time (seconds)
  end: number;          // End time (seconds)
  word_count: number;   // Word count
  raw: WordResult[];    // Original Deepgram words
}
```

### Example

```json
{
  "speaker": 0,
  "text": "Hello, how are you feeling today?",
  "start": 0.0,
  "end": 2.5,
  "word_count": 6,
  "raw": [
    {"word": "Hello", "start": 0.0, "end": 0.4, "confidence": 0.99, "speaker": 0},
    {"word": "how", "start": 0.5, "end": 0.7, "confidence": 0.98, "speaker": 0},
    {"word": "are", "start": 0.8, "end": 0.9, "confidence": 0.97, "speaker": 0},
    {"word": "you", "start": 1.0, "end": 1.2, "confidence": 0.99, "speaker": 0},
    {"word": "feeling", "start": 1.3, "end": 1.8, "confidence": 0.96, "speaker": 0},
    {"word": "today", "start": 1.9, "end": 2.4, "confidence": 0.98, "speaker": 0}
  ]
}
```

## Dominant Speaker Detection

For interim transcripts, determine speaker from word majority:

```typescript
function getDominantSpeaker(words: Word[]): number {
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
```

## Storage

Chunks are stored in Supabase `transcripts2.transcript_chunk` as JSONB array:

```sql
transcript_chunk JSONB[]
```

### Append Operation

```typescript
const existingChunks = transcript.transcript_chunk || [];
const updatedChunks = [...existingChunks, ...newChunks];

await supabase
  .from('transcripts2')
  .update({ transcript_chunk: updatedChunks })
  .eq('id', transcriptId);
```

## Full Transcript Text

Flattened text is rebuilt from chunks:

```typescript
const text = chunks
  .map(c => `[Speaker ${c.speaker}]: ${c.text}`)
  .join('\n');
```

Output format:
```
[Speaker 0]: Hello, how are you feeling today?
[Speaker 1]: I've been having some headaches lately.
[Speaker 0]: I see. When did they start?
```

## Accuracy Considerations

### Diarization Quality

- Works best with 2 distinct speakers
- May struggle with similar voices
- Background noise affects accuracy

### Improvement Strategies

1. Use good quality microphone
2. Ensure speakers take turns
3. Position microphone appropriately
4. Consider post-processing correction

## Metrics

Track diarization quality:

```typescript
interface DiarizationMetrics {
  totalChunks: number;
  speakerCounts: Record<number, number>;
  avgChunkDuration: number;
  speakerSwitches: number;
}
```
