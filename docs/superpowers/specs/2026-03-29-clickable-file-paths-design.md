# Clickable File Path Links in CodeMirror Editor

**Date:** 2026-03-29
**Status:** Approved

## Problem

The global CLAUDE.md references files like `~/.claude/UI-STANDARDS.md`, `~/.claude/WINDOWS-BUILD-VM.md`, etc. There's no way to open or edit these referenced files from the Workbench UI — users must use a terminal editor or create a separate session.

## Solution

Add a CodeMirror ViewPlugin decoration to the existing CodeMirrorEditor component that detects local file paths in editor content and renders them as clickable links. Clicking a path opens the file in a new floating editor window within the Workbench page (using the existing `claudeMdStore.openFile()` flow).

## Detection Rules

- Match paths starting with `~/` or absolute paths starting with `/home/`, `/etc/`, `/var/`, `/opt/`
- Must end with a recognized file extension: `.md`, `.json`, `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.sh`, `.yaml`, `.yml`, `.toml`, `.cfg`, `.conf`, `.txt`, `.css`, `.html`, `.env`
- Path boundaries: backticks, quotes (single/double), whitespace, or start/end of line
- Skip paths inside fenced code blocks (lines between ``` markers) to avoid false positives from example commands

## Interaction

- Detected paths get a subtle underline decoration (dotted, muted color)
- Hover: pointer cursor, tooltip "Ctrl+Click to open"
- **Ctrl+Click** (or Cmd+Click on Mac) opens the file — prevents accidental navigation while editing
- Regular click does nothing (normal cursor placement for editing)
- `~` in paths is expanded to the user's home directory (fetched from the existing `/api/config/public` endpoint which provides `home_dir`)
- If the file doesn't exist or can't be read, the API returns an error and the store handles it gracefully (file won't open, no crash)

## Architecture

### Frontend only — no backend changes needed

The existing backend endpoints already support this:
- `GET /claude-md?path=...` reads any file within allowed directories
- `PUT /claude-md` writes any file within allowed directories
- `_is_safe_path()` in `backend/api/claude_md.py` validates paths are under `~/.claude/` or `~/projects/`
- `GET /api/config/public` provides `home_dir` for tilde expansion

### CodeMirror Plugin

A `ViewPlugin` that:
1. On document/viewport changes, scans visible lines for file path patterns
2. Creates `Decoration.mark()` ranges with a CSS class for styling
3. Attaches a click handler via `EditorView.domEventHandlers` that checks for Ctrl/Cmd+Click on decorated ranges
4. Resolves the path (tilde expansion) and calls `claudeMdStore.openFile(resolvedPath)`

### File changes

- **Modify:** `frontend/src/components/ui/CodeMirrorEditor.tsx` — add the file path detection ViewPlugin as an extension, add CSS for link styling
- **Modify:** `frontend/src/index.css` — add `.cm-file-link` styles (underline, hover cursor) if not possible inline via CodeMirror theme

## Out of Scope

- Creating new files from the editor (only opens existing files)
- Paths outside the backend's allowed directories (`~/.claude/` and `~/projects/`)
- Non-file URLs (http links, etc.)
- File path autocompletion
