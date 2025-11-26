# GHOST-NEXT Roadmap

## Phase Overview

```
Phase 1: Foundation ──────▶ Phase 2: Storage ──────▶ Phase 3: Autopilot ──────▶ Phase 4: Production
   (Current)                  (Next)                  (Future)                   (Release)
```

---

## Phase 1: Foundation (Current)

**Goal:** Working overlay + real-time transcription

### Completed
- [x] Chrome MV3 extension structure
- [x] Shadow DOM overlay (Ferrari UI)
- [x] Audio capture (16kHz PCM)
- [x] WebSocket streaming
- [x] Deepgram integration (nova-2)
- [x] Speaker diarization
- [x] Real-time transcript display

### In Progress
- [ ] Supabase connection
- [ ] Transcript persistence
- [ ] Session management

### Deliverables
1. Extension loads and injects overlay
2. Microphone capture works
3. Audio streams to backend
4. Deepgram returns transcripts
5. Overlay displays real-time text
6. Basic start/stop controls

---

## Phase 2: Storage & Retrieval

**Goal:** Persistent transcripts with chunking

### Tasks
- [ ] Implement `transcripts2` table
- [ ] Implement `transcript_chunks` table
- [ ] Chunk aggregation (≤30s per chunk)
- [ ] Speaker-aware chunking
- [ ] Full transcript reconstruction
- [ ] Session resume capability
- [ ] Transcript export (text/JSON)

### Database Schema
```sql
transcripts2
├── id (UUID)
├── provider_id
├── patient_code
├── status
├── started_at
├── ended_at
└── metadata (JSONB)

transcript_chunks
├── id (UUID)
├── transcript_id (FK)
├── chunk_index
├── speaker
├── text
├── start_time
├── end_time
├── confidence
└── words (JSONB)
```

### Deliverables
1. Transcripts saved to Supabase
2. Chunks stored with speaker info
3. Full transcript retrievable
4. Session history viewable

---

## Phase 3: Autopilot & DOM Mapping

**Goal:** Smart field detection and auto-fill

### Tasks
- [ ] DOM field scanner
- [ ] Field categorization (ML/pattern)
- [ ] Patient info extraction
- [ ] Field mapping UI
- [ ] Send-to-field action
- [ ] Smart Fill (AI summary)
- [ ] Undo/history tracking
- [ ] Multi-field batch fill

### Autopilot Features
```
┌─────────────────────────────────────────┐
│  Autopilot Mode                         │
├─────────────────────────────────────────┤
│  Detected Fields:                       │
│  ├── Chief Complaint ────▶ [Send]      │
│  ├── HPI ─────────────────▶ [Send]      │
│  ├── Assessment ──────────▶ [Send]      │
│  └── Plan ────────────────▶ [Send]      │
│                                         │
│  [Smart Fill All]    [Undo Last]       │
└─────────────────────────────────────────┘
```

### Deliverables
1. Fields auto-detected
2. One-click field population
3. AI-generated content option
4. Undo capability

---

## Phase 4: Production Hardening

**Goal:** Stable, secure, deployable

### Tasks
- [ ] Error recovery (all paths)
- [ ] Reconnection logic
- [ ] Rate limiting
- [ ] RLS policies (Supabase)
- [ ] Authentication flow
- [ ] Audit logging
- [ ] Performance optimization
- [ ] Chrome Web Store prep

### Security Checklist
- [ ] No secrets in extension
- [ ] Server-side API keys only
- [ ] RLS on all tables
- [ ] Input sanitization
- [ ] CORS configuration
- [ ] Rate limiting

### Monitoring
- [ ] Error tracking (Sentry)
- [ ] Usage analytics
- [ ] Performance metrics
- [ ] Health checks

### Deliverables
1. Stable under load
2. Graceful error handling
3. Secure data flow
4. Ready for distribution

---

## Timeline (Estimated)

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1 | 2 weeks | In Progress |
| Phase 2 | 2 weeks | Not Started |
| Phase 3 | 3 weeks | Not Started |
| Phase 4 | 2 weeks | Not Started |

---

## Dependencies

### Phase 1
- Deepgram API key
- Chrome browser
- Node.js 18+

### Phase 2
- Supabase project
- Database migrations
- Service role key

### Phase 3
- Phase 2 complete
- Field pattern library
- AI model access (optional)

### Phase 4
- All phases complete
- Security audit
- Load testing results

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Deepgram rate limits | Buffer audio, batch requests |
| WebSocket instability | Auto-reconnect with backoff |
| Large transcripts | Chunk storage, pagination |
| DOM variations | Flexible pattern matching |
| Browser updates | Follow MV3 best practices |

---

## Success Metrics

### Phase 1
- Audio latency < 500ms
- Transcript accuracy > 90%
- No crashes in 1hr session

### Phase 2
- Zero data loss
- Query time < 100ms
- Full transcript < 5s

### Phase 3
- Field detection > 80%
- Fill accuracy > 95%
- User satisfaction > 4/5

### Phase 4
- 99.9% uptime
- Zero security incidents
- < 1% error rate
