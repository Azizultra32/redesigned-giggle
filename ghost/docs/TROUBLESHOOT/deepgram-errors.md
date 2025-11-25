# Deepgram Error Troubleshooting

## Common Errors

### AUTH_ERROR

**Error Message:**
```
[Deepgram] Error: AUTH_ERROR - Invalid API key
```

**Causes:**
1. API key not set in .env
2. API key invalid or expired
3. API key copied incorrectly (whitespace)

**Solutions:**

1. Check .env file:
```bash
cat backend/.env | grep DEEPGRAM
# Should show: DEEPGRAM_API_KEY=your_key_here
```

2. Verify key in Deepgram dashboard:
   - Go to https://console.deepgram.com/
   - Check API Keys section
   - Verify key is active

3. Test key directly:
```bash
curl -X POST "https://api.deepgram.com/v1/listen?model=nova-2" \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @test.wav
```

4. Check for whitespace:
```bash
# Key should have no leading/trailing spaces
echo "[$DEEPGRAM_API_KEY]"
```

---

### CONNECTION_LOST

**Error Message:**
```
[Deepgram] Connection closed unexpectedly
```

**Causes:**
1. Network interruption
2. Server timeout (no audio sent)
3. Rate limiting

**Solutions:**

1. Check network connectivity:
```bash
ping api.deepgram.com
```

2. Verify audio is streaming:
   - Check DevTools Network tab
   - WebSocket should show binary frames

3. Check rate limits:
   - Deepgram has concurrent connection limits
   - Close other sessions

4. Implement reconnection:
```typescript
// Already implemented in deepgram.ts
// Automatic reconnect with exponential backoff
```

---

### RATE_LIMIT

**Error Message:**
```
[Deepgram] Error: Rate limit exceeded
```

**Causes:**
1. Too many concurrent connections
2. Too many API calls per minute

**Solutions:**

1. Check your plan limits at console.deepgram.com
2. Reduce concurrent sessions
3. Implement request queuing

---

### INVALID_AUDIO

**Error Message:**
```
[Deepgram] Error: Invalid audio format
```

**Causes:**
1. Wrong encoding specified
2. Corrupt audio data
3. Sample rate mismatch

**Solutions:**

1. Verify audio format matches config:
```typescript
// Expected format:
{
  encoding: 'linear16',    // 16-bit PCM
  sample_rate: 16000,      // 16kHz
  channels: 1              // Mono
}
```

2. Check AudioContext settings:
```typescript
const audioContext = new AudioContext({
  sampleRate: 16000  // Must match Deepgram config
});
```

3. Debug audio data:
```typescript
// Log first few bytes to verify format
console.log('Audio sample:', new Int16Array(buffer.slice(0, 20)));
```

---

### NO_TRANSCRIPT

**Symptom:**
Connection works but no transcript returned

**Causes:**
1. Audio too quiet
2. No speech detected
3. VAD filtering everything

**Solutions:**

1. Check microphone levels:
   - Browser should show mic activity
   - Speak louder or closer to mic

2. Verify audio is reaching Deepgram:
```javascript
// Log in deepgram.ts
sendAudio(data) {
  console.log('Sending audio:', data.byteLength, 'bytes');
  // ...
}
```

3. Disable VAD temporarily:
```typescript
// In Deepgram config
{
  vad_events: false,  // Disable to test
  // ...
}
```

4. Check interim results:
```typescript
// Ensure interim_results is true
{
  interim_results: true,
  // ...
}
```

---

### DIARIZATION_ISSUES

**Symptom:**
All speech attributed to same speaker

**Causes:**
1. Diarization not enabled
2. Only one voice detected
3. Speakers too similar

**Solutions:**

1. Verify diarization enabled:
```typescript
{
  diarize: true,  // Must be true
  // ...
}
```

2. Check word-level speaker IDs:
```typescript
// Log in handleTranscript
console.log('Words:', data.channel.alternatives[0].words);
// Each word should have speaker: 0 or speaker: 1
```

3. Test with distinct voices:
   - Male/female mix easier to distinguish
   - Distance speakers further apart

---

## Debug Mode

Enable verbose logging:

```typescript
// In deepgram.ts constructor
constructor(options) {
  this.debug = true;
  // ...
}

// Log all events
this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
  if (this.debug) {
    console.log('[Deepgram] Raw transcript:', JSON.stringify(data, null, 2));
  }
  this.handleTranscript(data);
});
```

---

## Quick Diagnostic

```bash
# 1. Test API key
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  https://api.deepgram.com/v1/projects

# 200 = OK, 401 = Bad key, 429 = Rate limited

# 2. Check backend logs
tail -f backend.log | grep Deepgram

# 3. Monitor WebSocket in browser
# DevTools → Network → WS → Messages tab
```

---

## Error Code Reference

| Code | Meaning | Action |
|------|---------|--------|
| AUTH_ERROR | Invalid API key | Check .env |
| NETWORK_ERROR | Connection failed | Check internet |
| RATE_LIMIT | Too many requests | Wait/upgrade plan |
| INVALID_FORMAT | Bad audio | Check encoding |
| TIMEOUT | No audio received | Check streaming |
