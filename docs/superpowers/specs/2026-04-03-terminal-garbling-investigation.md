# Terminal Text Garbling Investigation

**Date:** 2026-04-03
**Status:** Root cause identified, fix in progress

## Problem Description

Text displayed in the web terminal (ttyd + xterm.js iframe) becomes garbled when Claude Code outputs large blocks of text instantly rather than streaming line-by-line. The garbling appears as mixed/overlapping content from different parts of the conversation.

### Symptoms

1. Text is fine while being output line-by-line (normal streaming)
2. When Claude Code renders an "instant block" (interactive questions, tool-use blocks, selection menus), lines above the block become garbled
3. Scrolling up reveals content from unrelated parts of the conversation mixed together
4. The garbling is permanent — scrolling away and back doesn't fix it

### Example: Garbled Output

User's prompt followed by fragments from earlier conversation and code:

```
❯ Now ask me a question and give me multiple options as if we're planning something. Don't actually      
  implementation in the diff might need finishing
  await self._send_json("e2e.key_confirm", {
      "session_id": self._session_id,
      "confirm": confirm,
      "role": self._role.value,
  [MEDIUM] Wire Format Header Size Inconsistency: Audio frame header
```

Lines 2-6 above are from completely different parts of the conversation, not related to the user's prompt.

### Example: Content Overwritten by Question Block

```
❯ I think we figured it out. When you output an instant block of text instead of line-by-line, the       
terminal gets confused and renders the output incorrectly. Can you do that again? Ask a question that    
─────────────────────────────────────────────────────────────────────────────────────────────────────────
 ☐ Focus area                                                                                            

Which area of the codebase should we improve first?
```

The user's prompt was cut off mid-sentence and replaced by the question block.

## Architecture

```
Claude Code CLI → tmux session → ttyd process (WebSocket) → xterm.js (in iframe) → React app
```

- **tmux**: Pure persistence layer, all keys unbound, mouse off, status off
- **ttyd**: Spawns xterm.js in browser, connects to tmux PTY
- **xterm.js**: Terminal emulator rendering to HTML5 canvas inside iframe
- **Key config**: `backend/tmux_workbench.conf` line 29: `set -g terminal-overrides 'xterm*:smcup@:rmcup@'`

## What We Tested

### 1. Diagnostic Logging System (implemented, still active)

Created a temporary diagnostic system that:
- Intercepts every `term.write()` call (before and after write coalescing)
- Captures buffer snapshots (10 lines around viewport edge) after large flushes
- Runs an integrity scan every 2 seconds comparing scrollback lines to detect corruption
- Logs to `/tmp/terminal-diag-{sessionId}.jsonl` via `POST /api/debug/terminal-log`

**Files:** `backend/api/debug.py`, additions to `frontend/src/components/terminal/TtydTerminal.tsx` and `backend/main.py` (all marked `// DIAG START` / `// DIAG END`)

### 2. Diagnostic Results (session e9b45827)

- **1,588 log entries** collected across an active session
- **794 flush events** with buffer snapshots
- **Zero `corruption-detected` events** from the integrity scanner
- **Zero `write-cursor` events** — no cursor movement sequences detected

The integrity scanner checks rows `baseY - 40` to `baseY - 10` (well above viewport). It found zero corruption there, meaning the deep scrollback is stable — the corruption is happening near the viewport where the question block overwrites content.

The zero cursor detections are likely because data arrives as binary `Uint8Array` from ttyd's WebSocket, and our cursor detection only checked string data.

### 3. Identified the Trigger

**Flush #3017**: 11,056 bytes in 3 WebSocket chunks coalesced into one animation frame. This was Claude Code's question block appearing instantly. The buffer snapshot showed `baseY` jumped from 222 to 232 (10 lines scrolled off-screen at once).

The question block itself is ~1,692 bytes / 14 lines visually, but with ANSI escape sequences the raw data is 11KB.

### 4. Fix Attempt 1: `requestAnimationFrame` refresh after large flushes

Added `term.refresh(0, rows-1)` on the next animation frame when a flush exceeded 2,000 bytes.

**Result:** Did not fix the garbling. The refresh ran before xterm.js's own renderer, so the buggy render overwrote our clean repaint.

### 5. Fix Attempt 2: Lowered threshold + newline count detection

Trigger on >1,000 bytes OR >5 newlines. Used `setTimeout(fn, 50)` instead of rAF.

**Result:** Did not fix the garbling.

### 6. Fix Attempt 3: Triple refresh at 0ms, 50ms, 150ms after every flush

Aggressive approach — force repaint 3 times after every single flush.

**Result:** Did not fix the garbling. This definitively proved the issue is NOT a canvas rendering problem. If the buffer data were correct, at least one of the three refreshes would have shown correct content.

## Root Cause Analysis

### The Cause: `smcup@:rmcup@` disabling alternate screen buffer

Line 29 of `backend/tmux_workbench.conf`:
```
set -g terminal-overrides 'xterm*:smcup@:rmcup@'
```

This tmux setting strips the alternate screen enter/exit escape sequences (`smcup` = `\033[?1049h`, `rmcup` = `\033[?1049l`). Here's the sequence of events:

1. **Claude Code sends "enter alternate screen"** (`\033[?1049h`) to draw its question UI
2. **tmux strips this** — xterm.js stays in the normal/main buffer
3. **Claude Code draws the question** using cursor positioning (`\033[H`, `\033[2J`, etc.) — these writes go to the **main buffer**, physically overwriting whatever content was in those rows
4. **User answers the question**, Claude Code sends "leave alternate screen" (`\033[?1049l`) which would normally restore the saved main buffer
5. **tmux strips this too** — the overwritten content is **permanently lost**

Without `smcup@:rmcup@`, the flow would be:
1. xterm.js switches to alternate screen buffer (separate memory)
2. Claude Code draws question in alternate buffer (main buffer untouched)
3. xterm.js switches back, restoring main buffer perfectly

### Why It Was Added

`smcup@:rmcup@` was originally added to fix mouse-wheel scrollback. Without it:
- When Claude Code is running (in alternate screen mode), mouse wheel sends arrow keys instead of scrolling the scrollback buffer
- Since Claude Code's entire TUI runs in alternate screen, users can never scroll up to see previous output while Claude Code is active

This setting has been toggled back and forth multiple times in the project history — removed to fix text corruption, restored to fix scrolling.

### Why refresh() Can't Fix It

`term.refresh()` forces the canvas renderer to repaint from the buffer. But the buffer itself is corrupted — Claude Code's question UI physically overwrote lines in the main buffer. Repainting from corrupted data produces corrupted display. This is not a rendering issue; it's a data issue.

## The Fix

### Immediate Fix: Remove `smcup@:rmcup@`

Remove line 29 from `backend/tmux_workbench.conf`. This re-enables alternate screen buffer, allowing xterm.js to properly isolate TUI content from the main scrollback.

**Tradeoff:** Mouse wheel will send arrow keys instead of scrolling while Claude Code is running in alternate screen mode. Users would need to exit Claude Code (or use Claude Code's built-in scroll) to access scrollback.

### Also: Remove the failed refresh attempts

The triple-refresh code added during debugging should be removed — it doesn't help and adds unnecessary overhead.

### Diagnostic code stays until fix is verified

All `// DIAG START` / `// DIAG END` code stays in place until we confirm the fix works. Then it gets removed in a cleanup commit.

### Future: Alternate scrollback solution

Potential approaches to restore mouse-wheel scrollback without `smcup@:rmcup@`:
- Configure xterm.js to intercept mouse wheel in alternate mode and translate to scrollback
- Use tmux's copy-mode or a custom key binding for scrollback access
- Investigate ttyd's scrollback options (`-a` flag)
- Use a JavaScript mouse-wheel handler in the iframe that detects alternate screen mode and scrolls the xterm.js scrollback buffer directly

## Files Modified During Investigation

| File | Purpose |
|------|---------|
| `backend/api/debug.py` | Temporary diagnostic log endpoint |
| `backend/main.py` | Debug router registration |
| `frontend/src/components/terminal/TtydTerminal.tsx` | Diagnostic instrumentation + failed refresh attempts |
| `backend/tmux_workbench.conf` | Root cause: `smcup@:rmcup@` on line 29 |
| `CHANGELOG.md` | Documented diagnostic addition |

## Working Fix

**Removed `smcup@:rmcup@` from `backend/tmux_workbench.conf`** (line 29). This re-enables the alternate screen buffer so xterm.js properly isolates TUI content from the main scrollback.

### Behavior After Fix

- **Main buffer is preserved**: When Claude Code shows an interactive question (arrow-key selection, etc.), the main buffer is saved by xterm.js and restored after the user answers. Content is no longer permanently destroyed.
- **During a question**: Scrolling up shows Claude Code's alternate buffer scrollback (its internal TUI state), which looks jumbled. This is normal and expected — it's not your real scrollback, it's Claude Code's working buffer.
- **After answering**: The main buffer is fully restored with all original content intact.
- **Mouse-wheel scrollback still works**: Scrolling up with the mouse wheel works normally in both regular output and after questions are dismissed. The original concern that removing `smcup@:rmcup@` would break mouse-wheel scrolling turned out to be unfounded.

### Failed Approaches (for reference)

These were all attempted before identifying the root cause:

1. **`requestAnimationFrame` refresh after large flushes** — Did not fix. xterm.js's own renderer ran after the refresh, overwriting it.
2. **`setTimeout(fn, 50)` refresh** — Did not fix. Same timing issue.
3. **Triple refresh at 0ms/50ms/150ms after every flush** — Did not fix. This proved the issue was buffer corruption, not canvas rendering. `term.refresh()` repaints from the buffer, so if the buffer is correct the display would be correct. Since refresh didn't help, the buffer itself was corrupted.

### Diagnostic System (removed after fix confirmed)

The temporary diagnostic system that was used during the investigation has been removed. It included:
- `backend/api/debug.py` — Log sink endpoint
- Instrumentation in `TtydTerminal.tsx` — Write logging, buffer snapshots, integrity scanner
- Debug router in `main.py`
- Log files at `/tmp/terminal-diag-{sessionId}.jsonl`

## How to Revert

If the fix causes worse problems:
```bash
# Re-add smcup@:rmcup@ to tmux config (add before the "Don't rename windows" line)
# Edit backend/tmux_workbench.conf and add:
set -g terminal-overrides 'xterm*:smcup@:rmcup@'

# New sessions will use the reverted config
# Existing sessions retain the config they were created with
```

Or revert the entire commit:
```bash
git log --oneline -5  # find the commit hash
git revert <hash>
```
