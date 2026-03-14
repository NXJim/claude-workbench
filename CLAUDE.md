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
- `CWB_BACKEND_PORT` — default 7860
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

---

## GitHub Push Rules (MANDATORY)

**`master` is the private branch. `main` is the public GitHub branch.** Never push `master` to GitHub. Never force-push `master` onto `main`. Always cherry-pick or manually apply changes from `master` to `main`.

### Branch Workflow

1. **Check out local `main`** from `origin/main` (delete and recreate if stale)
2. **Apply only the intended changes** — manually edit or `git checkout master -- <file>` for new files
3. **Audit every diff** before committing (see checklist below)
4. **Commit with clean identity**: author `JimNX <cw@nomaxtech.com>`
5. **Push `main`** to `origin/main`
6. **Switch back to `master`** for local development

### What NEVER Goes to GitHub

| Category | Examples | Why |
|----------|----------|-----|
| **Private backend services** | `backend/api/deploy.py`, `backup.py`, `health.py`, `system.py` | Server-specific deployment/backup/health infrastructure |
| **Private backend service modules** | `backend/services/deployer.py`, `backup_manager.py`, `deploy_config.py`, `health_checker.py` | Implementation of above |
| **SystemPanel** | `frontend/src/components/layout/SystemPanel.tsx` | Exposes server management UI (deploy, logs, ports, UFW) |
| **Systemd service files** | `workbench-backend.service`, `workbench-frontend.service` | Server-specific service configuration |
| **Private changelog/planning** | `CHANGELOG.md`, `TODO.md`, `IDEAS.md`, `.claude/plans/` (especially `feature-expansion.md`) | Contains private work history and decisions |
| **Screenshots/images in root** | `*.png`, `*.jpg` in project root (not `docs/`) | Temporary test artifacts, may contain terminal output |
| **Personal data notes** | `backend/data/notes/` | User-created notes with potentially private content |
| **`.env` file** | `.env` | Contains runtime configuration (`.env.example` is fine) |

### Pre-Push Audit Checklist

Before committing on `main`, run ALL of these:

```bash
# 1. Check diff contains ONLY intended files
git diff --stat HEAD

# 2. Scan for personal identifiers
git diff HEAD | grep -iE 'nomax|nomaxtech|nomaxos|waymaker'

# 3. Scan for IP addresses and local paths
git diff HEAD | grep -iE '192\.168|/home/nomax|\.local'

# 4. Scan for project names that reveal the server's contents
git diff HEAD | grep -iE 'dog-training|location-tracker|fake-gps|dasaita|nx-heatmap'

# 5. Scan for email addresses (except cw@nomaxtech.com which is the fake commit email)
git diff HEAD | grep -iE '@.*\.(com|net|org|io)' | grep -v 'cw@nomaxtech.com' | grep -v 'noreply@anthropic.com'

# 6. Verify git identity on the commit
git log -1 --format="%an <%ae> | %cn <%ce>"
# Must show: JimNX <cw@nomaxtech.com> | JimNX <cw@nomaxtech.com>
```

**ALL checks must return clean (empty) results before pushing.** If any check finds a match, investigate and fix before proceeding.

### Fixing Git Identity

If the commit shows the wrong author/committer:

```bash
GIT_COMMITTER_NAME="JimNX" GIT_COMMITTER_EMAIL="cw@nomaxtech.com" \
  git commit --amend --author="JimNX <cw@nomaxtech.com>" --no-edit
```

### What IS Safe to Push

- All frontend components (except `SystemPanel.tsx`)
- Frontend hooks, stores, utilities, types
- `frontend/index.html`, `frontend/src/index.css`, Tailwind config
- `frontend/src/api/client.ts` (but audit for hardcoded paths)
- Backend core: `main.py`, `config.py`, `database.py`, `schemas.py`
- Backend APIs: `sessions.py`, `projects.py`, `notes.py`, `snippets.py`, `clipboard.py`, `config_api.py`, `notifications.py`, `layout.py`
- Backend services: `ttyd_manager.py`, `project_discovery.py`, `project_creator.py` (audit for hardcoded paths)
- Scripts: `setup.sh`, `scripts/start.sh`
- Config templates: `.env.example`, `README.md`, `CLAUDE.md`
- New feature files that don't contain personal data
