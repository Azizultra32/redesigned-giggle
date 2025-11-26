# Pull Request Advice & Remaining Work Analysis

This document provides analysis and recommendations for the remaining pull requests and outstanding work in the AssistMD Truth Package repository.

---

## Executive Summary

The repository has **2 open PRs** and several **TypeScript type alignment issues** that should be addressed before merging. The core architecture is complete (Option A), but type definitions need synchronization between components.

---

## Open Pull Requests

### PR #2: Merge origin/main into feature branch

**Status**: ✅ Ready to Merge (with caveat)

**Summary**: 
- Syncs `copilot/merge-feature-branch` with latest `origin/main`
- 0 additions, 0 deletions, 0 changed files (pure merge commit)
- No conflicts detected

**Recommendation**: 
This PR can be merged or closed, depending on whether the `copilot/merge-feature-branch` is still needed. If the feature work is complete and merged to main via PR #5, this PR can be **closed as obsolete**.

---

### PR #6: Advise on remaining pull requests (This PR)

**Status**: 📝 Advisory PR

This PR (the one you're reading) contains the analysis and recommendations for the repository.

---

## TypeScript Issues Requiring Attention

### CNS Agent (`apps/cns-agent`) - 4 Errors

| Error | Location | Issue | Fix |
|-------|----------|-------|-----|
| TS2341 | `server.ts:63` | `broadcast` is private in `WsBridge` | Make `broadcast` public or add a public wrapper method |
| TS2322 | `server.ts:64` | `'active_tab_changed'` not in `WsMessage` type | Add `'active_tab_changed'` to the `WsMessage` union type |
| TS2339 | `server.ts:121` | `mrn` doesn't exist on `DomMap` | `DomMap` type has `mrn` as optional - import from correct source or use optional chaining |
| TS2339 | `server.ts:529` | `timestamp` doesn't exist on `TranscriptChunk` | Add `timestamp` field to `TranscriptChunk` interface |

#### Recommended Fixes for CNS Agent:

**1. Update `types/index.ts` - Add timestamp to TranscriptChunk:**
```typescript
export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw: WordResult[];
  timestamp?: number;  // Optional: Added for command routing; populated when chunks are mapped for UI display
}
```

**2. Update `types/index.ts` - Add active_tab_changed message type:**
```typescript
export interface ActiveTabChangedMessage {
  type: 'active_tab_changed';
  tabId: string;
  timestamp: number;
}

export type WsMessage = StatusMessage | TranscriptMessage | AlertMessage | CommandMessage | ActiveTabChangedMessage;
```

**3. Update `lib/ws-bridge.ts` - Make broadcast public or add wrapper:**
```typescript
// Either change the access modifier on the broadcast method:
// FROM: private broadcast(message: WsMessage): void { ... }
// TO:   public broadcast(message: WsMessage): void { ... }

// Or add a public wrapper method that calls the private one:
public broadcastMessage(message: WsMessage): void {
  this.broadcast(message);
}
```

**4. Fix `server.ts:121` - Use DomMap from tab-manager:**
```typescript
// DomMap is imported from tab-manager.js which has different interface
// Either use optional chaining:
const patientUuid = `patient-${domMap.mrn || 'unknown'}`;
// Or access via patientHint:
const mrn = domMap.patientHint?.mrn || 'unknown';
```

---

### Overlay (`apps/overlay`) - 9 Errors

| Error | Location | Issue | Fix |
|-------|----------|-------|-----|
| TS2345 | `overlay.ts:92` | TabId types incompatible between files | Unify TabId definition |
| TS2345 | `overlay.ts:159,163,170,179,189` | Event types not in `BridgeEventType` | Add missing event types to Bridge |
| TS2345 | `overlay.ts:259,269,311` | More missing event types | Same fix |

#### Recommended Fixes for Overlay:

**1. Update `bridge.ts` - Add missing event types:**
```typescript
export type BridgeEventType =
  | 'transcript'
  | 'connection'
  | 'patient'
  | 'start-recording'
  | 'stop-recording'
  | 'recording-started'
  | 'recording-stopped'
  | 'recording-error'
  | 'audio-status'
  | 'map-fields'
  | 'fields-detected'
  | 'fields-changed'
  | 'get-patient-info'
  | 'server-error'
  | 'toggle-overlay'
  // Add these:
  | 'hello'
  | 'hello_ack'
  | 'bind_audio'
  | 'audio_bound'
  | 'autopilot'
  | 'feed_status'
  | 'command'
  | 'command_result';
```

**2. Update `ui/tabs.ts` - Align TabId with overlay.ts:**
```typescript
// Add 'settings' to TabId in overlay.ts OR remove from tabs.ts
// Choose one source of truth for TabId
export type TabId = 'summary' | 'soap' | 'transcript' | 'tasks' | 'patient' | 'debug' | 'settings';
```

---

## Remaining Roadmap Work (From docs/SPEC/roadmap.md)

### Phase 1: Foundation - In Progress ⚠️
- [x] Chrome MV3 extension structure
- [x] Shadow DOM overlay (Ferrari UI)
- [x] Audio capture (16kHz PCM)
- [x] WebSocket streaming
- [x] Deepgram integration (nova-2)
- [x] Speaker diarization
- [x] Real-time transcript display
- [ ] **Supabase connection** ← Requires fixing cns-agent TypeScript errors (TS2339 on DomMap.mrn, TS2339 on TranscriptChunk.timestamp)
- [ ] **Transcript persistence** ← Requires cns-agent to compile; depends on Supabase connection
- [ ] **Session management** ← Requires overlay TypeScript fixes (BridgeEventType additions) for proper UI integration

### Phase 2: Storage & Retrieval - Not Started
- [ ] `transcripts2` table implementation
- [ ] Chunk aggregation (≤30s per chunk)
- [ ] Speaker-aware chunking
- [ ] Full transcript reconstruction
- [ ] Transcript export

### Phase 3: Autopilot & DOM Mapping - Not Started
- [ ] DOM field scanner
- [ ] Field categorization
- [ ] Patient info extraction
- [ ] Field mapping UI
- [ ] Smart Fill

### Phase 4: Production Hardening - Not Started
- [ ] Error recovery
- [ ] Reconnection logic
- [ ] RLS policies
- [ ] Authentication flow

---

## Priority Action Items

### Immediate (Before any PR merges)

1. **Fix TypeScript errors in cns-agent** (4 errors)
   - Priority: HIGH
   - Estimated time: 1-2 hours
   - Blocks: All backend functionality

2. **Fix TypeScript errors in overlay** (9 errors)
   - Priority: HIGH
   - Estimated time: 1-2 hours
   - Blocks: Extension build

### Short-term (This week)

3. **Complete Phase 1 items**
   - Supabase connection verification
   - Transcript persistence testing
   - Session management implementation

4. **Close PR #2** if feature branch is no longer needed

### Medium-term (Next sprint)

5. **Begin Phase 2 implementation**
   - Focus on chunk aggregation
   - Implement full transcript reconstruction

---

## Testing Recommendations

Before merging any code changes:

```bash
# Backend
cd apps/cns-agent
npm install
npm run typecheck  # Should pass with 0 errors

# Overlay
cd apps/overlay
npm install
npm run typecheck  # Should pass with 0 errors
npm run build      # Should produce valid extension
```

### End-to-End Test Checklist

- [ ] Backend starts on port 3001 without errors
- [ ] `/health` endpoint returns valid status
- [ ] Extension loads in Chrome without errors
- [ ] Overlay appears on Alt+G
- [ ] Recording starts/stops via Alt+R
- [ ] WebSocket connection established
- [ ] Transcript appears in overlay

---

## Architecture Notes

The repository follows the "Option A (Clean Repo Spec)" pattern:

- **Single `transcripts2` table** - No legacy sessions/transcripts/doctors tables
- **Two-phase patient identity** - Ephemeral code → Real UUID binding
- **Feed A-E WebSocket model** - Labeled feeds for different data streams
- **Shadow DOM overlay** - Style isolation for the Ferrari UI

All new code should adhere to these patterns. See `docs/ASSISTMD_TRUTH_PACKAGE.md` for complete specification.

---

## Conclusion

The main blockers are **TypeScript type misalignments** between:
1. `types/index.ts` ↔ `server.ts` (missing fields, incorrect access modifiers)
2. `bridge.ts` ↔ `overlay.ts` (missing event types)
3. `overlay.ts` ↔ `ui/tabs.ts` (TabId mismatch)

Fixing these 13 TypeScript errors will unblock the build and allow Phase 1 completion.

---

*Generated: 2025-11-26*
*Version: 1.0.0*
