# Claude Workbench

Web-based terminal manager for persistent Claude Code sessions.

## Tech Stack
- **Backend**: FastAPI + SQLite (aiosqlite) + uvicorn
- **Terminal**: ttyd (per-session process, handles xterm.js internally)
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS 4 + Zustand
- **Persistence**: tmux (invisible config — no keybindings, no mouse, no status bar)
- **Window management**: react-mosaic (tiling) + custom floating layer

## Configuration
All settings in `.env` (see `.env.example`). Key variables:
- `CWB_PUBLIC_HOST` — auto-detected if unset
- `CWB_BACKEND_PORT` — default 8084
- `CWB_FRONTEND_PORT` — default 5173 (dev mode only)
- `CWB_PROJECTS_ROOT` — default ~/projects
- `CWB_TTYD_PORT_BASE` / `CWB_TTYD_PORT_MAX` — ttyd port range (9100-9200)

## Key Architecture
- Each terminal session gets a ttyd process (embedded via iframe in frontend)
- tmux is a pure persistence layer (all keys unbound, mouse off, status off)
- ttyd handles xterm.js rendering, copy/paste, mouse selection, and resize
- Quick Paste sends commands via tmux send-keys (since iframe is cross-origin)
- Activity detection polls tmux for the current pane command (process-based, not byte-rate)
- Notifications delivered via SSE (/api/notifications/stream)
- Sessions survive browser closes and reconnections
- No auth (LAN-only dev tool)

## Running

### Production (single process)
```bash
./setup.sh          # first-time setup
./scripts/start.sh  # starts backend (serves built frontend)
```

### Development (hot reload)
```bash
./scripts/start.sh --dev  # backend + Vite dev server
```

## Contributing
- All configuration via `.env` — no hardcoded IPs or user paths
- Frontend paths fetched from `GET /api/config/public`
- Backend config in `backend/config.py` (uses python-dotenv)
