# Fix Terminal Overlapping Text After Workspace Switch

## Problem
When switching workspaces and back, terminal iframes get destroyed and recreated. xterm.js reconnects to tmux, which replays the scrollback buffer. During this replay, rendering artifacts (overlapping text) accumulate in the xterm.js canvas. The actual tmux terminal content is fine — the issue is purely in xterm.js's rendering of the replayed content.

## File to modify
- `frontend/src/components/terminal/TtydTerminal.tsx`

## Approach
In the existing `waitForTerm()` injected script (inside `handleIframeLoad`), after the key handler and IME suppression code, add a staggered full redraw using `term.refresh(0, rows-1)`. This tells xterm.js to re-render every row from scratch, clearing any overlapping glyphs left from the scrollback replay.

```js
setTimeout(function() { window.term.refresh(0, window.term.rows - 1); }, 500);
setTimeout(function() { window.term.refresh(0, window.term.rows - 1); }, 2000);
```

## Acceptance criteria
- [ ] Switch workspace A → B → A: terminal text renders cleanly without overlap
- [ ] Terminal still works normally (typing, scrolling, selection)
- [ ] No console errors from the refresh calls

## Status: Implemented (2026-03-27)
- Added staggered `term.refresh(0, rows-1)` at 500ms and 2000ms in the injected waitForTerm() script.
- Removed `smcup@:rmcup@` from tmux_workbench.conf to re-enable alternate screen buffer. This was the root cause of text overwriting/disappearing during Claude Code output — cursor manipulation was corrupting the main buffer instead of operating in the isolated alternate screen.

## What NOT to change
- Resize functionality (already works)
- Backend / ttyd_manager / ttyd_proxy (not the cause)
- Layout store / workspace switching logic
