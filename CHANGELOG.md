# Changelog

## 2026-03-26

### Fixed: Blank terminals — rebuilt ttyd 1.7.7 from source
- **`bin/ttyd`** — The pre-compiled ttyd 1.7.7 binary (statically linked with libwebsockets 4.3.3) had a known bug (tsl0922/ttyd#1456) where WebSocket connections accepted but PTY output was never sent to the browser. Replaced with a source-built binary linked against the system's libwebsockets 4.0.20, which works correctly. Added `-W` flag (writable mode, required for ttyd ≥1.7).
- **`backend/services/ttyd_manager.py`** — Added `-W` flag for ttyd 1.7.7 writable mode. Removed `-P 0` (disable WS ping) that was added speculatively by a previous session.
- **`backend/api/ttyd_proxy.py`** — Reverted write coalescing changes from previous session. The coalescing implementation had a protocol bug (checked for binary 0x00 type bytes, but ttyd uses ASCII '0' = 0x30) and was irrelevant in dev mode where Vite's raw pipe proxy handles WebSocket traffic.

### Fixed: Settings panel and sidebar rendered behind floating terminal windows
- **`frontend/src/stores/layoutStore.ts`** — Lowered floating window z-index range from 100–9000 to 10–200. Renormalization threshold reduced accordingly so floating windows never exceed UI chrome z-levels.
- **`frontend/src/components/layout/AppShell.tsx`** — Bumped header to `z-[300]`, mobile sidebar to `z-[350]`, mobile backdrop to `z-[320]`.
- **`frontend/src/components/layout/Sidebar.tsx`** — Bumped hover-expanded sidebar overlay to `z-[300]`.
- **`frontend/src/components/workspace/DockZoneOverlay.tsx`** — Bumped dock zone overlay to `z-index: 250`.

### Added: Category folder sync — settings panel creates/renames folders on disk
- **`backend/api/settings.py`** — Added `_sync_category_folders()` which detects renames (by index position), creates new folders, and renames existing ones when saving category changes. Folders are never deleted on category removal.
- **`frontend/src/components/layout/SystemPanel.tsx`** — Updated help text to explain rename/create/remove folder behavior.

## 2026-03-25

### Added: Workspace tab scroll overflow with chevron arrows
- **`frontend/src/components/layout/WorkspaceTabBar.tsx`** — When workspace tabs exceed the available width (capped at 50vw), left/right chevron arrows appear at the edges to scroll the tab strip. Uses `overflow-x: hidden` with smooth `scrollBy`, a `ResizeObserver` to detect size changes, and scroll event tracking. Tabs now have `flex-shrink-0` and `whitespace-nowrap` so they never compress or wrap. The `+` button stays inside the scrollable area; context menu and confirm dialog remain fixed-positioned outside.

## 2026-03-24 (v2026.03.24.001)

### Added: Workspace tab drag-and-drop reordering + color accents
- **`frontend/src/components/layout/WorkspaceTabBar.tsx`** — Tabs are now draggable via native HTML drag events. Drop indicator shows as a blue line at the insertion point. Right-click context menu now includes a color picker with 8 preset swatches plus a "no color" option. Selected color renders as a vertical accent line to the left of the tab label.
- **`frontend/src/stores/layoutStore.ts`** — Added `reorderWorkspaces` and `setWorkspaceColor` actions with optimistic updates.
- **`frontend/src/api/client.ts`** — Added `reorderWorkspaces()` API method, `sort_order` and `color` fields to `LayoutPresetData`.
- **`backend/models.py`** — Added `sort_order` (Integer) and `color` (String, nullable) columns to `LayoutPreset`.
- **`backend/schemas.py`** — Added `sort_order` and `color` to `LayoutPresetResponse` and `color` to `LayoutPresetUpdate`.
- **`backend/api/layouts.py`** — Added `PUT /layouts/reorder` endpoint. List endpoint now sorts by `sort_order` then `id`. Update endpoint accepts `color`. Route ordering fixed (reorder before parameterized route).
- **`backend/database.py`** — Added migrations for `sort_order` and `color` columns.

### Fixed: Garbled terminal output at start of long Claude responses (write coalescing)
- **`backend/api/ttyd_proxy.py`** — Replaced frame-by-frame WebSocket relay with deadline-based write coalescing. During output bursts, the proxy now accumulates ttyd binary frames (type 0x00) for up to 8ms or 32KB before flushing them as a single merged frame. This lets xterm.js parse and render a large chunk atomically instead of thrashing on dozens of micro-frames. Control messages (title, prefs) are still forwarded immediately. No changes to the input direction (keystrokes remain instant).
- **`backend/main.py`** — Version bumped to 2026.03.24.001.

## 2026-03-23

### Fixed: Terminal flicker on workspace switch
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — Added module-level URL cache (`Map<sessionId, url>`). On remount after workspace switch, cached URL is used instantly — no API call, no 500ms delay, no "Starting terminal..." flash. Cache is cleared on error.

### Fixed: Floating window z-order scrambled on workspace switch
- **`frontend/src/stores/layoutStore.ts`** — Added `zOrderFrozenUntil` timestamp. `bringToFront` is suppressed for 2s after `switchWorkspace` and `restoreLayout` to prevent iframe focus polling from reordering windows as they load.

### Fixed: Terminal keyboard input broken after ttyd upgrade
- **`backend/services/ttyd_manager.py`** — Added `-W` (writable) flag to ttyd launch command. ttyd v1.7.7 defaults to read-only; v1.6.3 was writable by default.

### Fixed: Garbled terminal output during long Claude Code responses
- **`backend/services/ttyd_manager.py`** — Reduced xterm.js scrollback from 50,000 to 15,000 lines (tmux still keeps 50,000 for search). Reduces renderer memory pressure during high-throughput streaming.
- **`backend/config.py`** — TTYD_BINARY now resolves project-local `bin/ttyd` first, falls back to system PATH. Supports `CWB_TTYD_BINARY` env override.
- **`setup.sh`** — ttyd install upgraded from 1.6.3 (apt, xterm.js ~4.19) to 1.7.7 (GitHub release, xterm.js 5.x). Installs to project-local `bin/ttyd` (no sudo). Version pinned and checked on each setup run.
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — Shift/Ctrl+Enter handler updated for xterm.js 5.x: tries public `input()` API first, falls back to private `triggerDataEvent()` for backward compat.
- **`.gitignore`** — Added `bin/` directory.
- **`.env.example`** — Documented `CWB_TTYD_BINARY` env var.

## 2026-03-20

### Fixed: Mobile sidebar & header issues (3 bugs)
- **`frontend/src/components/layout/AppShell.tsx`** — Added `relative z-50` to header so it stays above mobile floating windows.
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Changed mobile container from `inset-0` to `inset-x-0 bottom-0 top-12` so floating windows render below the header bar. Removed per-window inline `zIndex` on mobile (CSS z-50 sufficient for full-screen sheets).
- **`frontend/src/stores/layoutStore.ts`** — Added z-index renormalization in `bringToFront`: remaps all floating window z-indexes starting from 100 when `nextZIndex > 9000`, preventing theoretical overflow into UI chrome z-ranges.
- **`frontend/src/components/layout/Sidebar.tsx`** — Workspace dropdown now renders via `createPortal` to `document.body` with `position: fixed`, preventing clipping by the sidebar's `overflow-y-auto` container.
- **`frontend/src/components/ui/ResizeDivider.tsx`** — Added `touchstart`/`touchmove`/`touchend` handlers mirroring mouse events. Uses `{ passive: false }` on touchmove to allow `preventDefault()` (prevents page scroll during drag). Increased hit area from 12px to 20px for better touch targeting.

### Fixed: Android keyboard autocorrect garbling terminal input
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — Injected `autocorrect="off"`, `autocomplete="off"`, `autocapitalize="none"`, and `spellcheck="false"` on xterm.js's hidden helper textarea. Also suppresses Grammarly-style extensions via `data-gramm` attributes. These attributes signal the Android IME to disable prediction/correction, addressing the mismatch between InputConnection-based text systems and xterm.js's raw input stream.

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
