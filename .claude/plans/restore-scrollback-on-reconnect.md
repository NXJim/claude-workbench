# Restore Terminal Scrollback on Reconnection

## Problem
Switching workspaces destroys the iframe → xterm.js scrollback buffer is lost. On reconnection, tmux only sends the current visible screen. User can't scroll up to see history.

## Files
- `backend/api/sessions.py` — `GET /sessions/{id}/scrollback` endpoint using `tmux capture-pane -S -50000 -E -1`
- `frontend/src/api/client.ts` — `getScrollback()` method
- `frontend/src/components/terminal/TtydTerminal.tsx` — fetch + inject in `waitForTerm()` script

## Acceptance criteria
- [ ] After workspace switch + return, scrollback history is available
- [ ] No duplicate content between injected history and live screen
- [ ] Terminal interaction works normally after injection

## Status: Implemented (2026-03-27)
Backend endpoint + frontend injection done. Backend restart needed for endpoint to become available. Tested `tmux capture-pane -S -50000 -E -1` directly — returns 2,222 lines of scrollback for an active session.
