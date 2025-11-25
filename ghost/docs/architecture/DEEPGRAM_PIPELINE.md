# Deepgram Pipeline

## Overview

GHOST-NEXT uses Deepgram's nova-2 model for real-time speech-to-text with speaker diarization.

## Configuration

```typescript
const connection = client.listen.live({
  model: 'nova-2',
  language: 'en-US',
  smart_format: true,
  punctuate: true,
  diarize: true,
  interim_results: true,
  utterance_end_ms: 1000,
  vad_events: true,
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1
});
```

### Key Settings

| Setting | Value | Purpose |
|---------|-------|---------|
| model | nova-2 | Best accuracy model |
| diarize | true | Speaker identification |
| interim_results | true | Real-time partial transcripts |
| utterance_end_ms | 1000 | Silence detection (1 second) |
| encoding | linear16 | PCM 16-bit audio |
| sample_rate | 16000 | 16 kHz audio |
| channels | 1 | Mono audio |

## Audio Format

The extension captures audio as:
- **Format**: PCM (linear16)
- **Sample Rate**: 16,000 Hz
- **Channels**: 1 (mono)
- **Bit Depth**: 16-bit

### Capture Code

```javascript
const audioContext = new AudioContext({ sampleRate: 16000 });
const processor = audioContext.createScriptProcessor(4096, 1, 1);

processor.onaudioprocess = (event) => {
  const float32 = event.inputBuffer.getChannelData(0);
  const pcm16 = convertToPCM16(float32);
  websocket.send(pcm16);
};
```

### Float32 to Int16 Conversion

```javascript
function convertToPCM16(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}
```

## Event Handling

### Transcript Events

```typescript
connection.on(LiveTranscriptionEvents.Transcript, (data) => {
  const alternative = data.channel.alternatives[0];

  // Get text and words
  const text = alternative.transcript;
  const words = alternative.words;
  const isFinal = data.is_final;

  // Determine speaker from words
  const speaker = getDominantSpeaker(words);
});
```

### Utterance End

```typescript
connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
  // Force flush current chunk
  chunkAggregator.forceFlush();
});
```

## Speaker Diarization

Deepgram assigns speaker IDs (0-49) to words. We determine the dominant speaker per transcript segment:

```typescript
function getDominantSpeaker(words) {
  const counts = {};
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

### Speaker Mapping

| Speaker ID | Role |
|------------|------|
| 0 | Provider (clinician) |
| 1 | Patient |
| 2+ | Additional participants |

## Chunk Aggregation

Transcripts are aggregated into chunks for storage:

### Rules

1. **Speaker Change**: New chunk when speaker changes
2. **Duration Limit**: New chunk when duration > 30 seconds
3. **Utterance End**: New chunk on Deepgram utterance_end event

### Implementation

```typescript
class ChunkAggregator {
  addWord(word) {
    if (!this.currentChunk) {
      this.startNewChunk(word);
      return;
    }

    const shouldFlush =
      word.speaker !== this.currentChunk.speaker ||
      (word.end - this.currentChunk.start) > 30;

    if (shouldFlush) {
      this.flush();
      this.startNewChunk(word);
    } else {
      this.currentChunk.raw.push(word);
      this.currentChunk.end = word.end;
    }
  }
}
```

## Error Handling

```typescript
connection.on(LiveTranscriptionEvents.Error, (error) => {
  console.error('[Deepgram] Error:', error);

  // Common errors:
  // - Invalid API key
  // - Rate limit exceeded
  // - Network connectivity issues
  // - Audio format mismatch
});
```

## Best Practices

1. **Buffer audio** - Don't send tiny packets
2. **Handle reconnection** - Deepgram connections can drop
3. **Process finals only** for storage - Interim results are for display
4. **Monitor latency** - Typical round-trip: 100-300ms

## Environment

```bash
DEEPGRAM_API_KEY=your_api_key_here
```

Never expose the API key in client-side code. Always proxy through backend.
