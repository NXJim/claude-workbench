# Fix: Ctrl+V paste delayed/wonky in terminal

## Context

After pressing Ctrl+V in the terminal, nothing appears visually until the user types another character. Pressing Ctrl+V twice causes duplicated paste content. The root cause is in the Ctrl+V handler in `TtydTerminal.tsx`.

## Root Cause

Line 97 of `TtydTerminal.tsx`:
```javascript
if (e.key === 'v') return false;
```

Returning `false` from xterm.js `attachCustomKeyEventHandler` suppresses xterm's native `0x16` handling, with the assumption that the browser's native paste event will fire and insert clipboard content. But inside the ttyd iframe, the native paste event either doesn't fire reliably or the resulting render doesn't flush until the next input event — causing the "invisible until next keystroke" behavior.

## Fix

**File:** `frontend/src/components/terminal/TtydTerminal.tsx` (line ~96-97)

Replace the passive `return false` with an active clipboard read + `term.paste()`:

```javascript
// Ctrl+V: read clipboard and paste explicitly
if (e.key === 'v') {
  navigator.clipboard.readText().then(function(text) {
    if (text) window.term.paste(text);
  }).catch(function() {
    // Fallback: use execCommand for older browsers / permission denial
    document.execCommand('paste');
  });
  e.preventDefault();
  return false;
}
```

This ensures:
1. `0x16` is still suppressed (return false)
2. Clipboard content is explicitly written via `term.paste()` — no reliance on native paste event propagation
3. Fallback to `document.execCommand('paste')` if clipboard API is denied (e.g., permission prompt not granted)
4. `e.preventDefault()` stops any residual browser handling that could double-paste

## Verification

1. Open terminal, copy some text, press Ctrl+V → content appears immediately
2. Press Ctrl+V once → only one copy inserted (no duplication)
3. Plain typing still works
4. Ctrl+C with selection still copies
5. Shift+Enter / Ctrl+Enter still sends LF
