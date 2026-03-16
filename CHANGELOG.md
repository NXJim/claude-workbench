# Changelog

## 2026-03-16

### Fixed: Dragging floating window stalls when cursor enters another terminal's iframe
- **`frontend/src/index.css`** — Added `body.window-dragging iframe { pointer-events: none }` rule to prevent iframes from capturing the pointer during drag/resize.
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Toggle `window-dragging` class on `document.body` during drag and resize operations.

### Fixed: Title bar click loses z-order to iframe focus polling
- **`frontend/src/components/workspace/FloatingWindowManager.tsx`** — The 150ms `activeElement` polling loop now tracks the last observed element and only calls `bringToFront` on transitions (when `activeElement` changes to a different iframe). Title-bar clicks use `preventDefault`, so `activeElement` doesn't change and the poll correctly ignores the stale iframe focus.

## 2026-03-15

### Fixed: Docked terminal duplicated as floating window after page refresh
- **`frontend/src/stores/layoutStore.ts`** — `saveLayout` and `updateWorkspace` sent `null` for `floating_json` when no floating windows existed, but the backend's `if data.floating_json is not None` guard skipped the update, leaving stale floating data in the DB. Changed to send `"[]"` so the column is always cleared. Added deduplication guard in `restoreLayout` and `switchWorkspace` that filters out floating windows whose IDs already exist in the tiling tree.

### Fixed: Restore Shift+Enter and Ctrl+Enter multi-line input in terminal
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — Re-added xterm.js key handler for Shift+Enter and Ctrl+Enter that sends LF (`\n`) instead of CR, enabling multi-line input in Claude Code and other raw-mode terminal apps. Lost in commit `7360922` (public branch preparation).

### Added: Drag-to-dock floating windows (Aero Snap-style)
- **`frontend/src/stores/layoutStore.ts`** — Added `dockTarget` state, `setDockTarget`/`clearDrag` actions, `dockToTile` action (swaps floating window into a tile, evicts current occupant), and `replaceLeaf` tree helper.
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Added hit-testing during drag (`elementFromPoint` for tiles, cursor Y for top-edge), dock execution on drop, `pointer-events: none` during drag so hit-testing sees through the floating window.
- **`frontend/src/components/workspace/TilingWorkspace.tsx`** — Added `data-tile-window-id` attribute to tile wrappers for hit-test targeting.
- **`frontend/src/components/workspace/DockZoneOverlay.tsx`** — New component: renders visual indicators (blue highlight bar at top edge, tile highlight overlay) during drag.
- **`frontend/src/components/layout/AppShell.tsx`** — Mounted `DockZoneOverlay` in `<main>`, added `data-workspace-main` attribute for bounds detection.
