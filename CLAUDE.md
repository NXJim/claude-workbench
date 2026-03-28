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
- `CWB_BACKEND_PORT` — default 8000
- `CWB_FRONTEND_PORT` — default 3000 (dev mode only)
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

## Per-Project Config: `.workbench.json`

Projects can include a `.workbench.json` file in their root to provide metadata to Workbench. Currently supported fields:

```json
{
  "backend_port": 8001,
  "frontend_port": 3001
}
```

- **`backend_port`** / **`frontend_port`**: Dev server ports. Used by the sidebar to show a link icon on web projects that opens the dev site in a new tab. Both fields are optional.
- This file is auto-created when a project is scaffolded via Workbench with ports specified.
- For existing projects, create it manually or ask Claude to create it.

## Scratch Pad Output

When you output commands, scripts, or code blocks that the user will need to copy, also write them to `.cwb-scratch.md` in the project root. **Overwrite the entire file each response** — the Workbench backend ingests entries into persistent storage automatically, then clears the file.

Wrap each block in `<cb>` tags with metadata attributes:

- `desc` (required): Short description of what the block does (max ~60 chars)
- `machine` (optional): Where to run it — "local", "dev", "prod", "docker", etc. Omit if obvious or universal.
- `lang` (optional): Syntax hint — "bash", "sql", "python", "json", "typescript", "javascript", "html", "css", "yaml". Default: auto-detect.

Rules:
- One `<cb>` per distinct thing the user would copy separately
- Commands that must run together go in a single `<cb>` block
- Plain text outside `<cb>` tags is ignored (use `desc` attribute instead)
- **Overwrite the file completely each time** — only include content from your latest response

Example `.cwb-scratch.md`:
```
<cb desc="Install project dependencies" lang="bash">
npm install zustand @tanstack/react-query
</cb>

<cb desc="Start the dev server" machine="local" lang="bash">
cd frontend && npm run dev
</cb>

<cb desc="Add avatar column to users table" machine="prod" lang="sql">
ALTER TABLE users ADD COLUMN avatar_url TEXT;
</cb>
```

## Dev Server Stability (MANDATORY — read before touching backend)

The dev-mode backend (`./scripts/start.sh --dev`) runs uvicorn with `--reload` (file watcher). Two known failure modes cause the site to go offline:

### 1. Never use the systemd service in dev mode
`workbench-backend.service` exists for production. If it's enabled while the dev backend is running, it crash-loops every 5 seconds (port 8000 already in use), and each restart cycle runs `kill_orphans()` which sends SIGTERM to all ttyd processes — killing every terminal. **Never run `systemctl start/restart/enable workbench-backend.service` while developing.** If you find it running, stop and disable it:
```bash
sudo systemctl stop workbench-backend.service && sudo systemctl disable workbench-backend.service
```

### 2. Don't pip install while the dev server is running
The file watcher monitors the entire `backend/` directory including `venv/`. A `pip install` touches 100+ files in `venv/`, triggering a reload. The reload hangs forever because the SSE notification stream (`/api/notifications/stream`) holds an open connection that blocks graceful shutdown. The worker never comes back and the site goes offline.

**If you need to install packages:** stop the backend first, install, then restart.

### 3. If the site stops loading
The most likely cause is the uvicorn reloader stuck on "Waiting for connections to close." Fix:
```bash
# Find and kill the hung backend
pkill -9 -f 'uvicorn.*8000|python main.py'
sleep 1
# Restart
cd /home/nomax/projects/tools/claude-workbench && ./scripts/start.sh --dev &
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

---

## Branch Code Differences (DO NOT MIX)

These files have intentionally different content on `master` vs `main`. When editing these files, always check the current branch (`git branch --show-current`) and use the correct values.

| File | `master` (private) | `main` (public) |
|------|---------------------|-----------------|
| `backend/api/system.py` | `SERVICES = ["workbench-backend", "workbench-frontend"]`, two-phase restart, default log `workbench-backend` | `SERVICES = ["claude-workbench"]`, simple restart, default log `claude-workbench` |
| `frontend/.../SystemPanel.tsx` | Two services (Backend + Frontend), Deploy tab, deploy-related project badges | Single service (Workbench), no Deploy tab |
| `backend/main.py` | Includes `deploy` router | No `deploy` router |
| `backend/schemas.py` | `ProjectInfo` has `has_deploy_yaml`, `has_deploy_script`, `last_deploy` | Those fields removed |
| `frontend/src/api/client.ts` | Has `getDeployConfig`, `triggerDeploy`, `getDeployStatus`, `createDeployWs` | Those methods removed |

**Rule**: If you're about to change a value in this table, STOP and verify you're using the correct branch's value. If unsure, ask.
