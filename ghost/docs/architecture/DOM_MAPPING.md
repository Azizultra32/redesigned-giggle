# DOM Mapping

## Overview

DOM mapping enables the overlay to intelligently position itself relative to EMR page elements and potentially interact with form fields.

## DOM Snapshot

```typescript
interface DOMSnapshot {
  timestamp: number;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: DOMElement[];
}

interface DOMElement {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  rect?: DOMRect;
  attributes?: Record<string, string>;
}
```

## Element Selection

### Priority Order

1. **ID selector** - Most reliable
   ```css
   #patient-header
   ```

2. **Class selector** - Good for repeated patterns
   ```css
   .chart-container
   ```

3. **Tag + index** - Last resort
   ```css
   main:first-of-type
   ```

### Creating Selectors

```typescript
function createSelector(element: DOMElement): string {
  if (element.id) {
    return `#${element.id}`;
  }

  if (element.className) {
    const classes = element.className.split(' ').filter(Boolean);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes[0]}`;
    }
  }

  return element.tagName.toLowerCase();
}
```

## Anchor Finding

The overlay looks for common EMR patterns to anchor itself:

```typescript
const patterns = [
  { id: 'patient-header' },
  { id: 'encounter-form' },
  { className: 'chart-container' },
  { className: 'patient-info' },
  { tagName: 'MAIN' },
  { tagName: 'ARTICLE' }
];

function findAnchorElement(snapshot: DOMSnapshot): DOMElement | null {
  for (const pattern of patterns) {
    const match = snapshot.elements.find((el) => {
      if (pattern.id && el.id === pattern.id) return true;
      if (pattern.className && el.className?.includes(pattern.className)) return true;
      if (pattern.tagName && el.tagName === pattern.tagName) return true;
      return false;
    });

    if (match) return match;
  }
  return null;
}
```

## Overlay Positioning

### Position Calculation

```typescript
function calculateOverlayPosition(
  anchor: DOMElement,
  overlayWidth: number,
  overlayHeight: number,
  viewport: { width: number; height: number }
): { top: number; left: number; position: string } {

  const rect = anchor.rect;

  // Prefer right side
  const rightSpace = viewport.width - rect.right;
  if (rightSpace >= overlayWidth + 20) {
    return {
      top: rect.top,
      left: rect.right + 10,
      position: 'right'
    };
  }

  // Try left side
  if (rect.left >= overlayWidth + 20) {
    return {
      top: rect.top,
      left: rect.left - overlayWidth - 10,
      position: 'left'
    };
  }

  // Fall back to bottom
  return {
    top: rect.bottom + 10,
    left: (viewport.width - overlayWidth) / 2,
    position: 'bottom'
  };
}
```

### Position Modes

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   ┌─────────────────────┐        ┌──────────────────┐         │
│   │                     │        │                  │         │
│   │    Page Content     │        │     OVERLAY      │◄─ right │
│   │                     │        │                  │         │
│   └─────────────────────┘        └──────────────────┘         │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   ┌──────────────────┐        ┌─────────────────────┐         │
│   │                  │        │                     │         │
│   │     OVERLAY      │◄─ left │    Page Content     │         │
│   │                  │        │                     │         │
│   └──────────────────┘        └─────────────────────┘         │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│   ┌────────────────────────────────────────────────────────┐  │
│   │                    Page Content                         │  │
│   └────────────────────────────────────────────────────────┘  │
│                                                                │
│                  ┌──────────────────┐                         │
│                  │                  │                         │
│                  │     OVERLAY      │◄─ bottom               │
│                  │                  │                         │
│                  └──────────────────┘                         │
└────────────────────────────────────────────────────────────────┘
```

## EMR Integration Patterns

### Common EMR Elements

| EMR | Patient Header | Note Area | Submit Button |
|-----|----------------|-----------|---------------|
| Epic | `#PatientBanner` | `.NoteEditor` | `#SignNote` |
| Cerner | `.patient-header` | `#NoteArea` | `.sign-button` |
| Athena | `#patientInfo` | `.note-content` | `#submitNote` |

### Detection Logic

```typescript
function detectEMR(snapshot: DOMSnapshot): string | null {
  // Check for Epic
  if (snapshot.elements.some(e => e.id === 'PatientBanner')) {
    return 'epic';
  }

  // Check for Cerner
  if (snapshot.elements.some(e => e.className?.includes('cerner-'))) {
    return 'cerner';
  }

  // Check for Athena
  if (snapshot.url.includes('athenahealth.com')) {
    return 'athena';
  }

  return null;
}
```

## Future: Form Interaction

Planned feature to auto-fill note fields:

```typescript
// Future implementation
async function insertTranscriptToNote(
  selector: string,
  transcript: string
): Promise<void> {
  const element = document.querySelector(selector);
  if (element instanceof HTMLTextAreaElement) {
    element.value = transcript;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
```

## Security Considerations

1. **No data exfiltration** - DOM data stays local
2. **User consent** - Clear indication of DOM access
3. **Minimal access** - Only read what's needed
4. **No modification** - Read-only (for now)
