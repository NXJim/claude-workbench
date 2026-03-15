# Changelog

## 2026-03-15

### Fixed: Restore Shift+Enter and Ctrl+Enter multi-line input in terminal
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — Re-added xterm.js key handler for Shift+Enter and Ctrl+Enter that sends LF (`\n`) instead of CR, enabling multi-line input in Claude Code and other raw-mode terminal apps. Lost in commit `7360922` (public branch preparation).

### Added: Drag-to-dock floating windows (Aero Snap-style)
- **`frontend/src/stores/layoutStore.ts`** — Added `dockTarget` state, `setDockTarget`/`clearDrag` actions, `dockToTile` action (swaps floating window into a tile, evicts current occupant), and `replaceLeaf` tree helper.
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Added hit-testing during drag (`elementFromPoint` for tiles, cursor Y for top-edge), dock execution on drop, `pointer-events: none` during drag so hit-testing sees through the floating window.
- **`frontend/src/components/workspace/TilingWorkspace.tsx`** — Added `data-tile-window-id` attribute to tile wrappers for hit-test targeting.
- **`frontend/src/components/workspace/DockZoneOverlay.tsx`** — New component: renders visual indicators (blue highlight bar at top edge, tile highlight overlay) during drag.
- **`frontend/src/components/layout/AppShell.tsx`** — Mounted `DockZoneOverlay` in `<main>`, added `data-workspace-main` attribute for bounds detection.
