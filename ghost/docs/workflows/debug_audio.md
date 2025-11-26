# Debug Audio Workflow

## Symptoms

- No transcript output
- Garbled/incorrect transcription
- Audio not streaming
- "Microphone access denied"

## Step 1: Check Microphone Permission

### In Browser

1. Click lock icon in address bar
2. Check "Microphone" permission
3. Should be "Allow"

### Request Permission Manually

Open DevTools console:
```javascript
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('Microphone access granted');
    stream.getTracks().forEach(t => t.stop());
  })
  .catch(err => console.error('Microphone denied:', err));
```

## Step 2: Verify Audio Capture

### Check AudioContext

In extension's content script context:
```javascript
// Check if AudioContext is created
console.log('AudioContext state:', window.__ghostAudioContext?.state);
// Should be: "running"
```

### Test Audio Levels

```javascript
// Add to content.js temporarily for debugging
processor.onaudioprocess = (event) => {
  const input = event.inputBuffer.getChannelData(0);
  const sum = input.reduce((a, b) => a + Math.abs(b), 0);
  const avg = sum / input.length;
  console.log('Audio level:', avg.toFixed(4));
  // Should show values > 0 when speaking
};
```

## Step 3: Verify WebSocket Streaming

### Check Connection State

```javascript
// In content script
console.log('WebSocket state:', window.__ghostWs?.readyState);
// 0 = CONNECTING
// 1 = OPEN (good)
// 2 = CLOSING
// 3 = CLOSED
```

### Monitor Binary Data

Backend logging:
```typescript
ws.on('message', (data) => {
  if (Buffer.isBuffer(data)) {
    console.log('Received audio:', data.length, 'bytes');
  }
});
```

Expected: ~8192 bytes per message (4096 samples × 2 bytes)

## Step 4: Check Deepgram Connection

### Backend Logs

Look for:
```
[Deepgram] Connecting to streaming API...
[Deepgram] Connected
```

If you see errors:
```
[Deepgram] Error: Invalid API key
```

### Test Deepgram Directly

```bash
# Send test audio file
curl -X POST "https://api.deepgram.com/v1/listen?model=nova-2" \
  -H "Authorization: Token YOUR_API_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @test-audio.wav
```

## Step 5: Audio Format Verification

### Expected Format

- Sample rate: 16,000 Hz
- Channels: 1 (mono)
- Encoding: linear16 (PCM 16-bit)

### Verify Conversion

```javascript
function convertToPCM16(float32Array) {
  // Check input
  console.log('Input samples:', float32Array.length);
  console.log('Sample range:', Math.min(...float32Array), 'to', Math.max(...float32Array));
  // Should be -1.0 to 1.0

  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  // Check output
  console.log('Output bytes:', buffer.byteLength);
  return buffer;
}
```

## Step 6: Check Deepgram Response

### Enable Verbose Logging

```typescript
connection.on(LiveTranscriptionEvents.Transcript, (data) => {
  console.log('Deepgram raw response:', JSON.stringify(data, null, 2));
});
```

### Expected Response Structure

```json
{
  "type": "Results",
  "channel_index": [0, 1],
  "duration": 1.5,
  "start": 0.0,
  "is_final": true,
  "channel": {
    "alternatives": [
      {
        "transcript": "hello world",
        "confidence": 0.99,
        "words": [...]
      }
    ]
  }
}
```

## Common Issues

### Issue: No audio reaching Deepgram

**Cause:** AudioContext not started
**Fix:** Ensure AudioContext created after user gesture

### Issue: Garbled text

**Cause:** Wrong sample rate
**Fix:** Verify AudioContext is 16000 Hz:
```javascript
new AudioContext({ sampleRate: 16000 })
```

### Issue: Silence detected but speech exists

**Cause:** Wrong input device selected
**Fix:** Specify device:
```javascript
navigator.mediaDevices.getUserMedia({
  audio: {
    deviceId: { exact: preferredDeviceId }
  }
})
```

### Issue: "Connection refused" to Deepgram

**Cause:** API key invalid or rate limited
**Fix:** Check Deepgram console for usage/errors

### Issue: Transcripts appear delayed

**Cause:** Buffer size too large
**Fix:** Reduce scriptProcessor buffer:
```javascript
audioContext.createScriptProcessor(2048, 1, 1) // Smaller buffer
```

## Diagnostic Script

Add to backend for troubleshooting:

```typescript
// Debug endpoint
app.get('/debug/audio', (req, res) => {
  const sessions = Array.from(broker.sessions.entries()).map(([ws, session]) => ({
    userId: session.userId,
    isRecording: session.isRecording,
    transcriptId: session.transcriptId,
    pendingChunks: session.pendingChunks.length,
    deepgramConnected: session.deepgram?.getConnectionState() ?? false
  }));

  res.json({ sessions });
});
```

## Audio Test File

Create test audio with ffmpeg:

```bash
# Generate 5 seconds of speech-like tone
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" \
  -ar 16000 -ac 1 -acodec pcm_s16le \
  test-audio.wav
```

Use for testing Deepgram connection independently.
