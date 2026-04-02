# Changelog

## 2026-04-02

### Fixed: Clicking floating terminal iframe doesn't bring window to front
- **`frontend/src/components/workspace/FloatingWindowManager.tsx`** — The iframe focus polling swallowed focus transitions during the 2-second `zOrderFrozenUntil` freeze window (set during layout restore on every page load). It updated `lastActiveElement` even when `bringToFront` was blocked, so the transition was never retried after the freeze expired. Fix: don't update `lastActiveElement` while frozen, allowing the poll to retry once the freeze lifts.

## 2026-04-01

### Fixed: Terminal scrolling in alternate screen mode
- **`backend/tmux_workbench.conf`** — Restored `set -g terminal-overrides 'xterm*:smcup@:rmcup@'` which disables alternate screen at the tmux level. Keeps xterm.js in normal screen mode so mouse wheel scrolls the scrollback buffer instead of sending arrow keys. This line was removed in a prior commit but the pre-reboot tmux sessions still had the old config, masking the regression.

### Changed: Terminal header icon improvements
- **`frontend/src/components/terminal/TerminalHeader.tsx`** — Changed notes toggle icon from pencil-in-square to a plain pencil (visually distinct from other icons). Changed docked pop-out icon from external-link arrow to overlapping squares (Windows "restore" style), distinguishing it from the notes icon.
- **`frontend/src/components/workspace/FloatingWindow.tsx`** — Changed notes toggle icon to plain pencil (matching tiled header). Replaced dock-back button with maximize button (tooltip "Maximize", calls `toggleMaximizeFloating`).

### Added: Auto-focus terminal on browser window activation
- **`frontend/src/hooks/useTerminalAutoFocus.ts`** (new) — Hook that listens for `window.focus` events. When the browser window gains focus from another application, auto-focuses the topmost floating terminal iframe (or first tiled terminal). Only fires when no specific UI element was clicked, preserving intentional focus targets.
- **`frontend/src/components/layout/AppShell.tsx`** — Wired up `useTerminalAutoFocus` hook.
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — Added `data-terminal-iframe` attribute to iframes for auto-focus targeting.

## 2026-03-29

### Added: Clickable file path links in CodeMirror editors
- **`frontend/src/components/ui/CodeMirrorEditor.tsx`** — Added a CodeMirror ViewPlugin that detects local file paths (`~/...`, `/home/...`, etc.) in editor content and renders them as clickable links. Ctrl+Click (Cmd+Click on Mac) opens the referenced file in a new floating editor window via `claudeMdStore.openFile()`. Paths inside fenced code blocks are excluded to avoid false positives.
- **`frontend/src/index.css`** — Added `.cm-file-link` styles (dotted underline, pointer cursor on hover).

### Added: Live terminal pane title display in web UI
- **`backend/services/activity_monitor.py`** — Replaced `_get_pane_command()` with `_get_pane_info()` that queries both `#{pane_current_command}` and `#{pane_title}` in a single tmux call. Added `_pane_titles` dict, `set_title_callback()`, and `get_title()`. Title changes fire a new `_on_title_changed` callback.
- **`backend/main.py`** — Registered `on_title_changed` callback that broadcasts `{"type": "pane_title"}` via SSE.
- **`frontend/src/stores/sessionStore.ts`** — Added `paneTitles` state map and `setPaneTitle()` action.
- **`frontend/src/hooks/useNotifications.ts`** — Added handler for `pane_title` SSE events.
- **`frontend/src/components/terminal/TerminalHeader.tsx`** — Displays pane title as secondary text next to session name. Falls back to project path when no title is set.

### Added: Dev Mode health check and repair in SystemPanel
- **`backend/api/dev_health.py`** (new) — Two endpoints: `GET /api/system/dev-health` scans for orphaned, duplicate, and stale processes on backend (port 8000) and frontend (port 3000) ports, plus lingering `start.sh --dev` instances. `POST /api/system/dev-repair` kills identified PIDs (validates they're workbench processes first), then relaunches `start.sh --dev` and polls for service startup.
- **`backend/main.py`** — Registered `dev_health_router`.
- **`frontend/src/api/client.ts`** — Added `getDevHealth()` and `devRepair(pids)` methods.
- **`frontend/src/components/layout/SystemPanel.tsx`** — Added "Dev Mode Processes" section to Services tab with two-step flow: Diagnose (scan for issues) then Repair (kill + restart with confirmation). Shows status dot (yellow=unchecked, green=healthy, red=issues), issue list with colored badges, and summary counts.
- **`scripts/start.sh`** — Added pre-flight port cleanup to `--dev` mode: kills processes occupying backend/frontend ports and stale `start.sh --dev` instances before starting, preventing orphan accumulation.

### Added: Real-time notes sync across browsers/devices
- **`backend/api/notes.py`** — Added SSE broadcast on note create, update content, update metadata, and delete. Uses existing `broadcast_notification()` infrastructure with event types: `note_created`, `note_updated`, `note_metadata`, `note_deleted`.
- **`frontend/src/stores/noteStore.ts`** — Added `refreshNoteContent(id)` (re-fetches from server, skips if mid-save or pending debounce) and `handleRemoteDelete(id)` (closes window, removes from state, refreshes list).
- **`frontend/src/hooks/useNotifications.ts`** — Added SSE handlers for note events: `note_updated` refreshes open note content, `note_created`/`note_metadata` refreshes the sidebar list, `note_deleted` closes the note and removes it.

### Added: "Send to Terminal" button on session notes panel
- **`frontend/src/components/terminal/SessionNotes.tsx`** — Added optional `onSend` prop and a "Send to Terminal" button in a footer bar. Sends the full notes content to the terminal. Button is disabled when notes are empty.
- **`frontend/src/components/workspace/TerminalTile.tsx`** — Wired `onSend` to `terminalRef.current?.sendData()`.
- **`frontend/src/components/workspace/FloatingWindow.tsx`** — Same wiring for floating window mode.

## 2026-03-28

### Improved: Voice input panel UX
- **`frontend/src/components/terminal/VoiceInputPanel.tsx`** — (1) Mic button now toggles the panel open/closed (fixed outside-click handler to exclude the anchor button so the toggle doesn't fight it). (2) Added "Close" button next to "Send". (3) Removed "Send + Enter" button. (4) Replaced standalone "Clear" button with an inline X icon inside the textarea (appears when text is present), matching typical search field UX. Updated hint text accordingly.
- **`frontend/src/components/terminal/TerminalHeader.tsx`** — Minor: used functional updater for `setShowVoiceInput` toggle.

### Enhanced: Scratch Pad — persistent command library with metadata and syntax highlighting
- **`backend/services/scratch_pad_manager.py`** (new) — Ingestion service that reads `.cwb-scratch.md`, parses `<cb>` blocks with metadata attributes (`desc`, `machine`, `lang`), appends entries to persistent `.cwb-scratch-history.json` per project, then clears the scratch file. Supports old-format (plain `<cb>` tags with text headers) and new-format (`<cb desc="..." machine="..." lang="...">`). File locking prevents race conditions. Auto-detects language from code content. Caps history at 500 entries (prunes oldest non-pinned).
- **`backend/api/scratch_pad.py`** — Expanded from single GET endpoint to full CRUD: GET (ingest + return history), DELETE single entry, DELETE all (pinned survive), PATCH (pin/unpin).
- **`frontend/src/components/scratch-pad/ScratchPadViewer.tsx`** — Complete rewrite. New `ScratchCard` component with: description text, machine badge (color-coded: red for prod, blue for dev, gray for local), relative timestamp, pin/unpin button (star), delete button (X), read-only CodeMirror code block with syntax highlighting, language badge, copy button. Added search/filter bar, entry count, "Clear all" with confirmation. Sort: pinned first, then newest.
- **`frontend/src/components/ui/CodeMirrorEditor.tsx`** — Added `minimal` prop (syntax highlighting only, no line numbers/gutters/autocomplete). Added bash/shell/zsh, SQL, and YAML language support via `@codemirror/legacy-modes`.
- **`frontend/src/api/client.ts`** — Added `ScratchEntry` and `ScratchPadResponse` types. Added `deleteScratchEntry`, `clearScratchPad`, `updateScratchEntry` methods.
- **`frontend/src/index.css`** — Added `.scratch-pad-codemirror` styles for compact read-only code blocks (12px font, 200px max height).
- **`~/.claude/CLAUDE.md`** + **`CLAUDE.md`** — Updated scratch pad instructions: `<cb>` tags now accept `desc`, `machine`, `lang` attributes. Backend handles persistence; Claude still overwrites file each response.

### Fixed: SystemPanel Settings tab content overlapping tabs
- **`frontend/src/components/layout/SystemPanel.tsx`** — Added `flex-shrink-0` to the tab bar so it never gets compressed by overflowing content. The scrollable content area (`flex-1 overflow-y-auto min-h-0`) now correctly scrolls independently.

### Changed: Merged Projects and Path tabs into single Settings tab
- **`frontend/src/components/layout/SystemPanel.tsx`** — Removed the Projects tab (project card list with health dots duplicated sidebar info). Moved "New Project" button into the Settings tab, above Projects Folder and Categories. Reduced from 6 tabs to 5: Services, Backups, Ports, Logs, Settings. Removed `ProjectsTab` function and `HealthDot` component. Removed redundant `max-h-[480px]` on PortsTab (parent handles scrolling).

### Fixed: Ports tab showing empty (missing backend endpoint)
- **`backend/api/projects.py`** — Implemented `GET /projects/ports` endpoint. Gathers port info from `discover_projects()` and parses UFW rules via `sudo -n ufw status` (non-interactive to avoid hanging). Returns project ports with UFW open/closed status and full UFW rule list. Skips IPv6 duplicate rules. Handles missing `dev_ports` key for projects without `.workbench.json`.

### Fixed: Garbled/misaligned Claude Code TUI when launching new terminal sessions
- **Root cause**: Previous fix (sending with Enter) still garbled because the command executed immediately at 120x30 before ttyd/xterm.js connected and resized tmux to the actual browser dimensions. Claude Code's TUI rendered at the wrong size, then got redrawn when the resize arrived.
- **`backend/api/sessions.py`** — Replaced synchronous `send_keys()` with `asyncio.create_task(_delayed_send_keys(...))` that waits 1.5s before sending the startup command. This gives ttyd time to connect and resize tmux to the correct browser dimensions first.
- **`backend/services/tmux_manager.py`** — Increased default tmux session size from 120x30 to 200x50, closer to typical web terminal dimensions, reducing the initial size mismatch.

## 2026-03-27 (v2026.03.27.005)

### Fixed: "Move to project" submenu overflowing past bottom of screen
- **`frontend/src/components/notes/NoteContextMenu.tsx`** — Submenu now uses `fixed` positioning with viewport-aware placement (callback ref measures on mount, shifts up if it would overflow bottom, flips left if it would overflow right). Added delayed close timer (100ms) so the mouse can cross the gap between trigger and submenu. Outside-click handler checks both menu and submenu refs.
- **`frontend/src/components/layout/ProjectMdFileContextMenu.tsx`** — Same fix applied to the project file context menu's "Move to project" submenu.

## 2026-03-27 (v2026.03.27.004)

### Fixed: Terminal sessions disconnecting immediately (ttyd killed by systemd restart loop)
- **Root cause**: `workbench-backend.service` systemd service was in a crash-restart loop. Every 5 seconds, a new uvicorn process started, ran `kill_orphans()` (which sends SIGTERM to all ttyd processes via pgrep), then failed to bind port 8000 (already in use by the dev-mode backend) and exited. This killed any ttyd process within seconds of spawning.
- **Fix**: Stopped and disabled `workbench-backend.service` to end the restart loop.
- **`backend/services/ttyd_manager.py`** — Hardened `Popen` call: added `start_new_session=True` so ttyd runs in its own process group (survives parent signals/restarts), changed `stderr=subprocess.PIPE` to `subprocess.DEVNULL` (pipe was never read, could eventually block ttyd).

## 2026-03-27 (v2026.03.27.003)

### Added: Double-click maximize/restore for floating windows
- **`frontend/src/stores/layoutStore.ts`** — Added `isMaximized` and `preMaximizeRect` fields to `FloatingWindow` interface. Added `toggleMaximizeFloating()` action: maximizes to workspace bounds, restores to saved rect, or swaps with an already-maximized window. Maximized windows get lower z-index so non-maximized floating windows stay accessible on top. Updated `bringToFront()` to skip maximized windows so they remain behind.
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Added double-click detection in `handleMouseDown` (mousedown timing, not `onDoubleClick`, because `pointer-events: none` during drag blocks the native event). Deferred `setInteracting(true)` to first mouse move so the 2nd mousedown of a double-click isn't blocked. Hides resize handle and switches cursor to `cursor-default` when maximized. Prevents drag on maximized windows.

## 2026-03-27 (v2026.03.27.002)

### Added: CodeMirror syntax highlighting in all editors
- **`frontend/src/components/ui/CodeMirrorEditor.tsx`** — New shared CodeMirror 6 wrapper with auto-detected language highlighting (markdown, HTML, JSON, CSS, JS/TS, Python), dark/light theme switching via MutationObserver on Tailwind's `dark` class, line wrapping, and external value sync without cursor reset.
- **`frontend/src/components/notes/NoteEditor.tsx`** — Replaced plain textarea with CodeMirrorEditor (markdown mode). Removed Preview toggle.
- **`frontend/src/components/claude-md/ClaudeMdEditor.tsx`** — Same replacement with language auto-detection from file extension. Removed Preview toggle.
- **`frontend/src/components/editor/EditorPage.tsx`** — Same replacement for standalone full-page editor. Removed Preview toggle.
- **`frontend/package.json`** — Added `codemirror`, `@codemirror/lang-*` (markdown, html, json, css, javascript, python), `@codemirror/language-data`, `@codemirror/theme-one-dark`.

### Added: Restore terminal scrollback on reconnection
- **`backend/services/tmux_manager.py`** — Extended `capture_scrollback()` with optional `end_line` parameter for `-E` flag support.
- **`backend/api/sessions.py`** — New `GET /sessions/{id}/scrollback` endpoint. Returns tmux scrollback history above the visible screen as plain text (`capture-pane -S -50000 -E -1`).
- **`frontend/src/api/client.ts`** — Added `getScrollback()` method returning raw text.
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — In the injected `waitForTerm()` script, fetches scrollback from the backend and writes it into xterm.js via `term.write()` so users can scroll up to see conversation history after workspace switch.

### Added: Open .md files in new browser tab
- **`frontend/src/components/editor/EditorPage.tsx`** — New standalone full-page markdown editor at `/edit?path=...`. Full-height textarea with auto-save, save indicator, and preview toggle. No AppShell chrome.
- **`frontend/src/App.tsx`** — Route detection: renders EditorPage when pathname is `/edit`, otherwise normal AppShell.
- **`frontend/src/components/layout/ProjectMdFileContextMenu.tsx`** — Added "Open in new tab" as first menu item. Added `isNote` prop: note files get full options (rename/move/delete), non-note files get only "Open in new tab".
- **`frontend/src/components/layout/ProjectTree.tsx`** — Right-click context menu now fires for ALL `.md` files in the expanded tree, not just `notes/` files.

### Added: Notes context menus — rename, move, create, delete
- **`backend/services/project_file_manager.py`** — New service for managing plain `.md` files in project `notes/` folders. Supports slugified filenames, conflict resolution (numeric suffix), and move operations between global/project/project.
- **`backend/api/project_files.py`** — New router with `POST /project-files/create`, `POST /project-files/rename`, `DELETE /project-files`, `POST /project-files/move` endpoints.
- **`backend/schemas.py`** — Added `ProjectFileCreate`, `ProjectFileRename`, `NoteMoveRequest` schemas.
- **`backend/main.py`** — Registered `project_files_router`.
- **`frontend/src/api/client.ts`** — Added `createProjectFile`, `renameProjectFile`, `deleteProjectFile`, `moveNote` API methods.
- **`frontend/src/stores/noteStore.ts`** — Added `renameNote`, `flushSave`, `moveNoteToProject` actions. Move flushes pending auto-save, closes old window, opens new file in claude-md editor at same position.
- **`frontend/src/stores/projectStore.ts`** — Added `createProjectNote`, `renameProjectFile`, `deleteProjectFile`, `moveProjectFileToGlobal`, `moveProjectFileBetweenProjects` actions with window identity management.
- **`frontend/src/components/notes/NoteContextMenu.tsx`** — Portal-rendered context menu for global notes: Rename, Pin/Unpin, Move to project (grouped by category), Delete.
- **`frontend/src/components/layout/ProjectMdFileContextMenu.tsx`** — Portal-rendered context menu for project `notes/*.md` files: Rename, Move to Global Notes, Move to project, Delete.
- **`frontend/src/components/notes/NotesSidebarSection.tsx`** — Right-click context menu on notes, inline rename (replaces title with input on Enter/blur save).
- **`frontend/src/components/layout/ProjectTree.tsx`** — "New note" item in project context menu (creates `.md` in `notes/`), right-click context menu on `notes/*.md` files, inline rename for project note files.

### Added: Expandable project tree with .md files
- **`backend/services/project_discovery.py`** — Scans for `.md` files in project root and up to 2 levels of subdirectories (skips node_modules, .git, venv, etc.). Returns as `md_files` list of relative paths.
- **`backend/schemas.py`** — Added `md_files: list[str]` to `ProjectInfo`.
- **`frontend/src/api/client.ts`** — Added `md_files: string[]` to `ProjectData` interface.
- **`frontend/src/components/layout/ProjectTree.tsx`** — Projects with `.md` files show a chevron toggle. Expanding reveals file list (TODO.md, IDEAS.md, .claude/plans/*.md, etc.). Clicking a file opens it in the existing CLAUDE.md floating editor.

### Added: Save indicator on note and markdown editors
- **`frontend/src/stores/noteStore.ts`** — Added `saveStatus` tracking: `'saving'` → `'saved'` (2s) → `'idle'`.
- **`frontend/src/stores/claudeMdStore.ts`** — Same save status pattern.
- **`frontend/src/components/notes/NoteEditor.tsx`** — Shows pulsing "Saving" dot during save, green checkmark "Saved" on success.
- **`frontend/src/components/claude-md/ClaudeMdEditor.tsx`** — Same save indicator in toolbar.

### Fixed: Floating window drag swaps with maximized tile
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Dock-to-tile hit-test now checks if the target tile covers ≥95% of the workspace (maximized). If so, Shift must be held to allow the swap. Normal drag over a maximized tile just repositions the floating window.

### Fixed: Terminal text overwriting / disappearing during Claude Code output
- **`backend/tmux_workbench.conf`** — Removed `set -g terminal-overrides 'xterm*:smcup@:rmcup@'` which disabled the alternate screen buffer. TUI programs (Claude Code, vim, less) use alternate screen for cursor manipulation; without it, their output overwrites the main buffer and text is permanently lost. With alternate screen re-enabled, xterm.js auto-converts wheel to arrow keys when in alt screen (handled by the running program), and scrolls its own 50K-line scrollback in normal mode.

### Fixed: Terminal overlapping text after workspace switch
- **`frontend/src/components/terminal/TtydTerminal.tsx`** — Added staggered `term.refresh(0, rows-1)` calls (500ms and 2000ms) in the injected `waitForTerm()` script. Forces xterm.js to fully re-render all rows after tmux scrollback replay on reconnection, clearing rendering artifacts.

### Changed: Replace native browser dialogs with custom ConfirmDialog
- **`frontend/src/components/notes/NotesSidebarSection.tsx`** — Note delete confirmation now uses `useConfirmDialog()` instead of `window.confirm()`.
- **`frontend/src/components/snippets/SnippetBrowser.tsx`** — Snippet delete confirmation now uses `useConfirmDialog()`.
- **`frontend/src/components/terminal/TerminalHeader.tsx`** — Session terminate confirmation now uses `useConfirmDialog()`.
- **`frontend/src/components/layout/SystemPanel.tsx`** — Backup delete and service stop confirmations now use `useConfirmDialog()`. Service stop uses `warning` variant (amber).

### Added: Scratch Pad — copy-friendly output viewer
- **`backend/api/scratch_pad.py`** — New endpoint `GET /api/scratch/{session_id}` reads `.cwb-scratch.md` from the session's project directory.
- **`backend/main.py`** — Registered scratch pad router.
- **`frontend/src/types/windows.ts`** — Added `scratch-pad` window type with `spad:` key prefix.
- **`frontend/src/api/client.ts`** — Added `getScratchPad()` API method.
- **`frontend/src/components/scratch-pad/ScratchPadViewer.tsx`** — Viewer component that polls the scratch file every 3s, parses markdown code blocks, and renders each with a per-block Copy button.
- **`frontend/src/components/scratch-pad/ScratchPadFloatingWindow.tsx`** — Floating window wrapper (emerald accent).
- **`frontend/src/components/workspace/FloatingWindowManager.tsx`** — Added `scratch-pad` dispatch case.
- **`frontend/src/components/terminal/TerminalHeader.tsx`** — Added scratch pad button (clipboard icon) to tiled terminal headers; only visible when session has a project path.
- **`frontend/src/components/workspace/TerminalTile.tsx`** — Passes `onOpenScratchPad` callback to TerminalHeader.
- **`frontend/src/components/workspace/FloatingWindow.tsx`** — Added scratch pad button to floating terminal header actions.
- **`CLAUDE.md`** — Added "Scratch Pad Output" instruction telling Claude to write copyable content to `.cwb-scratch.md`.

### Changed: Shrink top dock drop zone
- **`frontend/src/components/workspace/FloatingWindowShell.tsx`** — Reduced hit-test threshold from 48px to 10px so the dock zone only triggers very close to the top edge.
- **`frontend/src/components/workspace/DockZoneOverlay.tsx`** — Shrunk visual overlay from 64px banner to 10px thin accent bar; removed text label.

## 2026-03-26

### Added: Move projects between categories
- **`backend/api/projects.py`** — New `POST /projects/move` endpoint. Validates source exists, target category exists, no active sessions, then `shutil.move()` on disk. Updates dead session records to point to the new path.
- **`frontend/src/components/layout/ProjectTree.tsx`** — Right-click context menu on project items with "Move to >" submenu listing all other categories. Disabled with "(active sessions)" label when sessions are alive.
- **`frontend/src/components/layout/SystemPanel.tsx`** — "Move Projects" section in Settings tab. Grouped by category with a dropdown per project to reassign category. Dropdown disabled for projects with active sessions.
- **`frontend/src/api/client.ts`** — Added `moveProject()` API method.
- **`frontend/src/stores/projectStore.ts`** — Added `moveProject` action that calls API and refreshes project list.
- **`backend/api/settings.py`** — Fixed `get_settings()` to use `get_project_categories()` (with filesystem merge) so all categories appear in context menus and dropdowns.

### Added: Plain terminal button in toolbar
- **`frontend/src/components/layout/AppShell.tsx`** — Added terminal icon button to the left of "Edit Global CLAUDE.md" in the toolbar. Opens a floating terminal session at the user's home directory without the `claude --dangerously-skip-permissions` prompt.
- **`backend/schemas.py`** — Added `skip_claude_prompt` field to `SessionCreate` (default `false`).
- **`backend/api/sessions.py`** — Made the Claude Code launch command conditional on `skip_claude_prompt`.
- **`frontend/src/api/client.ts`** — Added `skip_claude_prompt` to `createSession` API call.
- **`frontend/src/stores/sessionStore.ts`** — Extended `createSession` action to accept `opts.skipClaudePrompt`.

### Added: Voice input for terminal sessions
- **`frontend/src/types/speech-recognition.d.ts`** — TypeScript declarations for the Web Speech API (SpeechRecognition, SpeechRecognitionEvent, etc.).
- **`frontend/src/hooks/useSpeechRecognition.ts`** — React hook wrapping the Web Speech API. Supports continuous listening with interim results, auto-restart on Chrome's ~60s silence timeout, and human-readable error messages.
- **`frontend/src/components/terminal/VoiceInputPanel.tsx`** — Dropdown panel with live transcript preview, editable textarea, Send/Paste/Clear buttons. Auto-starts listening on open. Same positioning pattern as QuickPasteMenu.
- **`frontend/src/components/terminal/TerminalHeader.tsx`** — Added microphone button next to Quick Paste (tiled terminals). Hidden if browser doesn't support Web Speech API.
- **`frontend/src/components/workspace/FloatingWindow.tsx`** — Added microphone button to floating terminal window header actions.

### Fixed: Voice input panel UX issues
- **`frontend/src/components/terminal/VoiceInputPanel.tsx`** — Panel now tracks anchor button position via `requestAnimationFrame` so it follows the floating window during drag. Added `stopPropagation` on mousedown to prevent the header's drag handler from intercepting clicks (fixes: panel not moving with window, drag-through to window, textarea appearing read-only). Swapped Send/Paste buttons so primary Send does not auto-press Enter; secondary "Send + ↵" sends with Enter. Replaced `userEdited` flag with delta-append approach so new transcription is always appended to the textarea even after manual edits.

### Fixed: Projects panel now shows all filesystem categories, not just hardcoded ones
- **`backend/services/project_discovery.py`** — `discover_projects()` now auto-discovers category directories from the filesystem instead of falling back to a hardcoded list (`web`, `apps`, `tools`, `data`).
- **`backend/api/settings.py`** — `get_project_categories()` now merges saved/default categories with any filesystem directories not already listed, so new folders like `applications`, `mobile-apps`, `pcb`, `archive` appear automatically.

### Changed: Workspace tab color indicator hidden when no active sessions
- **`frontend/src/components/layout/WorkspaceTabBar.tsx`** — The colored vertical accent line on workspace tabs is now only rendered when the workspace has at least one alive session. Polls workspace session counts every 10 seconds (piggybacks on the existing orphan session poll).
- **`frontend/src/stores/sessionStore.ts`** — Added `workspaceSessionCounts` state and `fetchWorkspaceSessionCounts` action that fetches all sessions and builds a `workspace_id → alive count` map.

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
