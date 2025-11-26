# Diarized Transcript Specification

## Overview

This spec defines how Deepgram real-time transcription is processed, chunked, and stored.

**CRITICAL:** Chunks are stored in `transcript_chunk jsonb[]` array in transcripts2 — NOT a separate table.

---

## Deepgram Payload Structure

Deepgram (streaming) returns this structure:

```json
{
  "type": "Results",
  "channel_index": [0, 1],
  "duration": 1.5,
  "start": 0.0,
  "is_final": true,
  "speech_final": true,
  "channel": {
    "alternatives": [
      {
        "transcript": "Hello, how are you feeling today?",
        "confidence": 0.98,
        "words": [
          {
            "word": "Hello",
            "start": 0.0,
            "end": 0.4,
            "confidence": 0.99,
            "speaker": 0,
            "punctuated_word": "Hello,"
          },
          {
            "word": "how",
            "start": 0.5,
            "end": 0.7,
            "confidence": 0.97,
            "speaker": 0,
            "punctuated_word": "how"
          }
        ]
      }
    ]
  }
}
```

### Words Array Fields
| Field | Type | Description |
|-------|------|-------------|
| `word` | string | Raw word |
| `start` | float | Start time (seconds) |
| `end` | float | End time (seconds) |
| `confidence` | float | Confidence score (0-1) |
| `speaker` | int | Speaker ID (0-49, streaming mode) |
| `punctuated_word` | string | Word with punctuation |

**NOTE:** `speaker_confidence` is NOT available in streaming mode.

---

## Diarization Settings (Deepgram)

```typescript
{
  model: 'nova-2',        // or 'nova-2-medical'
  language: 'en-US',
  smart_format: true,
  punctuate: true,
  diarize: true,          // REQUIRED for speaker IDs
  interim_results: true,
  utterance_end_ms: 1000,
  vad_events: true,
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1
}
```

---

## Chunk Aggregation Rules

Start new chunk when:
1. **Speaker changes** — `newWord.speaker !== chunk.speaker`
2. **Duration exceeds 30s** — `(current_word.end - chunk.start) > 30`
3. **Utterance end** — On utterance_end event from Deepgram

```typescript
interface ChunkBuffer {
  speaker: number;
  words: Word[];
  start: number;
  end: number;
}

function shouldFlushChunk(buffer: ChunkBuffer, newWord: Word): boolean {
  // Flush if speaker changes
  if (newWord.speaker !== buffer.speaker) return true;

  // Flush if chunk exceeds 30 seconds
  if (newWord.end - buffer.start > 30) return true;

  return false;
}
```

---

## Chunk Object Structure

Each chunk stored in `transcript_chunk jsonb[]`:

```json
{
  "speaker": 0,
  "text": "Hello, how are you feeling today?",
  "start": 0.0,
  "end": 2.5,
  "word_count": 7,
  "raw": [
    {
      "word": "Hello",
      "start": 0.0,
      "end": 0.4,
      "confidence": 0.99,
      "speaker": 0
    },
    {
      "word": "how",
      "start": 0.5,
      "end": 0.7,
      "confidence": 0.97,
      "speaker": 0
    }
  ]
}
```

### Chunk Fields
| Field | Type | Description |
|-------|------|-------------|
| `speaker` | number | Speaker ID (integer) |
| `text` | string | Joined tokens (full text) |
| `start` | float | Chunk start time |
| `end` | float | Chunk end time |
| `word_count` | int | Number of words |
| `raw` | array | Original Deepgram words |

---

## Persist Pattern

```typescript
// 1. Aggregate words into chunk
const chunk: TranscriptChunk = {
  speaker: dominantSpeaker,
  text: words.map(w => w.punctuated_word || w.word).join(' '),
  start: words[0].start,
  end: words[words.length - 1].end,
  word_count: words.length,
  raw: words
};

// 2. Append to transcript_chunk array
await saveTranscriptChunks(transcriptId, [chunk]);

// 3. Keep fullTranscript as flattened text
// (done automatically by saveTranscriptChunks)
```

---

## Event Flow

```
Browser Mic → PCM Audio → WebSocket /audio-stream → Agent Server
                                                        ↓
                                                  Deepgram API
                                                        ↓
                                                  JSON Results
                                                        ↓
                                                 Chunk Aggregator
                                                        ↓
                                            ┌───────────┴───────────┐
                                            ↓                       ↓
                                      WebSocket emit          Supabase UPDATE
                                      (to overlay)            transcript_chunk[]
                                            ↓                       ↓
                                      Overlay Feed            transcript text
```

---

## Full Sequence

```
[Overlay.RecordButton]
      ↓ PCM
[EXT → WebSocket /audio-stream]
      ↓ Deepgram
[Agent.ChunkAssembler]
      ↓ JSONB chunk
[Supabase.transcripts2.transcript_chunk]
      ↓ profile + chunks
[Agent.broadcast /ws]
      ↓ update UI
[Overlay.TranscriptFeed]
```

---

## Error Handling

| Error | Action |
|-------|--------|
| Deepgram AUTH_ERROR | Log, notify overlay, stop recording |
| Deepgram connection lost | Attempt 3 reconnects with exponential backoff |
| Empty transcript | Skip, do not save |
| Invalid speaker ID | Default to speaker 0 |
| Supabase write fail | Log error, continue streaming (don't lose audio) |
