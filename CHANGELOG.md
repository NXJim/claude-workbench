# Changelog

## 2026-03-19

### Added: `.workbench.json` for per-project dev port config
- **`backend/services/project_discovery.py`** — Reads `.workbench.json` from each project root to populate `dev_ports` (backend_port, frontend_port).
- **`backend/services/project_creator.py`** — Auto-creates `.workbench.json` when a project is scaffolded with ports specified. Also adds Workbench integration note to generated CLAUDE.md.
- **`frontend/src/components/layout/ProjectTree.tsx`** — Link button now shows for any project with dev ports (not just web category).
- **`CLAUDE.md`** — Documented `.workbench.json` format and purpose.

### Fixed: Systemd killing tmux sessions on backend restart
- **`/etc/systemd/system/workbench-backend.service`** — Added `KillMode=process` so systemd only kills the main uvicorn process on restart, leaving tmux sessions alive.
- **`scripts/claude-workbench.service.template`** — Added `KillMode=process` to the service template for fresh installs.
- **Root cause**: tmux was spawned as a child of the backend, landing in the same cgroup. Default `KillMode=control-group` killed everything on restart.

### Added: Prefill Claude Code command in new sessions
- **`backend/api/sessions.py`** — New sessions prefill `claude --dangerously-skip-permissions` in the terminal so the user only has to press Enter. Can be backspaced away if not wanted.

### Added: Crash-resilient tmux sessions (remain-on-exit)
- **`backend/services/tmux_manager.py`** — Sessions now set `remain-on-exit on` so the tmux session survives when the process inside exits. Added `is_pane_dead()`, `respawn_pane()`, and `ensure_remain_on_exit()` functions.
- **`backend/services/activity_monitor.py`** — Detects dead panes via `#{pane_dead}` tmux variable; fires `on_pane_dead` callback instead of treating as session death.
- **`backend/main.py`** — Startup sets remain-on-exit on all existing sessions. Added `on_pane_dead` SSE notification.
- **`backend/api/sessions.py`** — New `POST /sessions/{id}/respawn` endpoint to restart a dead pane. New `GET /sessions/orphaned` endpoint for sessions with no workspace.

### Added: Orphaned sessions tab
- **`backend/main.py`** — `_cleanup_orphaned_tmux_sessions()` replaced with `_adopt_orphaned_tmux_sessions()` which creates DB records for unmatched tmux sessions (workspace_id=NULL) instead of killing them.
- **`backend/database.py`** — Removed auto-adoption that force-assigned workspace_id to NULL sessions on startup.
- **`frontend/src/api/client.ts`** — Added `listOrphanedSessions()` and `respawnSession()` API methods.
- **`frontend/src/stores/sessionStore.ts`** — Added `orphanedSessions` state, `fetchOrphanedSessions()`, `adoptOrphan()`, and `respawnSession()` actions.
- **`frontend/src/components/layout/WorkspaceTabBar.tsx`** — Amber "Orphaned (N)" tab appears when orphaned sessions exist; disappears when all are moved.
- **`frontend/src/components/layout/Sidebar.tsx`** — Orphaned view shows recovered sessions with Move (to workspace), Restart (respawn dead pane), and Delete buttons.
- **`frontend/src/stores/layoutStore.ts`** — `switchWorkspace` handles virtual orphaned workspace (ID=-1); guards prevent persisting -1 as active workspace.

### Changed: Port migration (standardized port scheme)
- Backend `8084` → `8000`, Frontend `5173` → `3000`, Apache port `80`.
- Updated `.env`, `backend/config.py`, `frontend/vite.config.ts`, `scripts/start.sh`, `scripts/install-service.sh`, `setup.sh`, systemd service file, `CLAUDE.md`.

### Added: Branch code differences documentation to prevent config bleed-through
- **`CLAUDE.md`** — Restored from master (was removed in `19c2146`). Added "Branch Code Differences (DO NOT MIX)" section documenting files that intentionally differ between master and main (SERVICES list, deploy features, schemas).
- **`~/.claude/.../memory/project_branch_differences.md`** — NEW project memory so future sessions know about the two-branch setup.
- **`~/.claude/.../memory/feedback_github_push_rules.md`** — Updated to reference the branch differences table.

### Fixed: Long Claude responses chopped off when scrolling
- **`backend/tmux_workbench.conf`** — Changed `mouse off` → `mouse on` so tmux forwards wheel events to applications (Claude Code scrolls its own complete buffer). Removed `smcup@:rmcup@` terminal override (no longer needed since xterm.js scrollback is not the scroll path). Updated comments. Text selection now uses Shift+click/drag for native xterm.js selection.

### Added: Session color picker in context menu
- **`frontend/src/components/ui/SessionContextMenu.tsx`** — Added "Color" submenu with 8-swatch palette grid (4x2). Shows current color highlighted with border. Hovering or clicking opens the picker; selecting a color calls `onColorChange` and closes the menu.
- **`frontend/src/components/layout/Sidebar.tsx`** — Wired `onColorChange` and `currentColor` props to sidebar session context menu.
- **`frontend/src/components/workspace/FloatingWindow.tsx`** — Wired `onColorChange` and `currentColor` props to floating window context menu.

### Changed: Sidebar pin/unpin with hover expand
- **`frontend/src/stores/layoutStore.ts`** — Replaced `sidebarCollapsed`/`toggleSidebar` with `sidebarPinned`/`toggleSidebarPin`/`setSidebarPinned`. Backward-compat: saves as `sidebar_collapsed: !sidebarPinned`, restores inverted.
- **`frontend/src/components/layout/Sidebar.tsx`** — Three-state rendering: pinned (full sidebar in flow), unpinned+collapsed (48px full-height strip with thumbtack icon rotated 45°, session dots), unpinned+hovering (strip + absolute overlay sidebar, 150ms debounce). Extracted `SidebarContent` and `PinIcon` components.
- **`frontend/src/components/layout/AppShell.tsx`** — Updated to use `sidebarPinned`/`toggleSidebarPin`/`setSidebarPinned` (inverted logic vs old `sidebarCollapsed`).
- **`frontend/src/hooks/useKeyboardShortcuts.ts`** — Ctrl+B now calls `toggleSidebarPin`.
- **`frontend/src/components/command-palette/CommandPalette.tsx`** — Command label changed to "Pin/Unpin Sidebar", calls `toggleSidebarPin`.

### Fixed: Restore two-service config (backend + frontend) for private branch
- **`backend/api/system.py`** — SERVICES reverted from `["claude-workbench"]` to `["workbench-backend", "workbench-frontend"]`. Restored two-phase restart logic (frontend first, then delayed backend). Default log service back to `workbench-backend`.
- **`frontend/src/components/layout/SystemPanel.tsx`** — SERVICES restored to Backend + Frontend entries. Default log service back to `workbench-backend`.

### Added: Move session to another workspace via context menu
- **`backend/schemas.py`** — Added `workspace_id` field to `SessionUpdate` schema so PATCH endpoint can reassign sessions.
- **`backend/api/sessions.py`** — Handle `workspace_id` in `update_session` PATCH handler.
- **`frontend/src/api/client.ts`** — Added `workspace_id` to `updateSession` parameter type.
- **`frontend/src/stores/sessionStore.ts`** — New `moveToWorkspace` action: updates backend, removes session from local state.
- **`frontend/src/components/ui/SessionContextMenu.tsx`** — **NEW** shared context menu with Rename, Move to (workspace submenu), and Delete options. Portal-rendered, clamped to viewport, close-on-outside-click.
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Added `onTitleBarContextMenu` prop, attached to desktop title bar.
- **`frontend/src/components/workspace/FloatingWindow.tsx`** — Wired context menu for terminal floating windows (right-click title bar).
- **`frontend/src/components/layout/Sidebar.tsx`** — Replaced right-click-to-rename with full context menu (Rename, Move to, Delete).

## 2026-03-16

### Fixed: Sidebar doesn't live-update when projects/categories are added
- **`frontend/src/components/layout/SystemPanel.tsx`** — SystemPanel's local `fetchProjects()` updated only component state (`setProjects`), never the global `useProjectStore`. Added `useProjectStore.getState().fetchProjects()` call so the sidebar's ProjectTree updates immediately after project creation or deletion.

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
