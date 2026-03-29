# Dev Mode Service Health & Repair

**Date:** 2026-03-29
**Status:** Approved

## Problem

When Claude Code sessions (or manual runs) start the Workbench backend via `python main.py` or `start.sh --dev`, the processes can outlive their parent and block port 8000. Multiple stale Vite instances also accumulate. The existing "Restart Services" button only manages systemd units, which aren't used in dev mode. There's no way to diagnose or fix this from the UI.

## Solution

1. A new "Dev Mode Processes" section in the SystemPanel Services tab with a two-step diagnose-then-repair flow.
2. Harden `start.sh --dev` to kill existing port occupants before starting.

## Backend API

### GET /api/system/dev-health

Scans for process issues and returns a structured report.

**Scanner checks:**
- Processes listening on port 8000 (via `ss -tlnp`): identifies PID, whether it's uvicorn or bare python, whether there are duplicates
- Processes listening on port 3000 (via `ss -tlnp`): same for Vite
- Duplicate `start.sh --dev` processes (via `pgrep -f`)
- Orphaned Vite processes: `node ... vite --host 0.0.0.0` under the workbench frontend directory
- Orphaned uvicorn/python processes matching workbench backend patterns

**Response:**
```json
{
  "healthy": false,
  "issues": [
    {
      "pid": 123456,
      "name": "python main.py",
      "port": 8000,
      "issue": "orphaned",
      "description": "Orphaned backend process on port 8000 (started Mar 27)"
    },
    {
      "pid": 234567,
      "name": "node vite --host 0.0.0.0",
      "port": 3000,
      "issue": "duplicate",
      "description": "Duplicate Vite process (3 instances found, expected 1)"
    }
  ],
  "summary": {
    "port_8000_count": 1,
    "port_3000_count": 3,
    "start_sh_count": 2,
    "orphaned_count": 4
  }
}
```

Issue types: `orphaned` (no parent start.sh), `duplicate` (multiple instances), `stale` (parent process dead), `port_conflict` (unexpected process on our port).

### POST /api/system/dev-repair

Kills identified processes and restarts dev services.

**Request body:**
```json
{
  "pids": [123456, 234567, 345678]
}
```

PIDs come from the diagnose response so the user knows exactly what will be killed.

**Behavior:**
1. Send SIGTERM to each PID
2. Wait 1 second
3. Check survivors, send SIGKILL to any remaining
4. Verify ports 8000 and 3000 are free
5. Launch `start.sh --dev` as a detached background process
6. Poll ports for up to 5 seconds to confirm services started
7. Return result

**Response:**
```json
{
  "success": true,
  "killed": [123456, 234567],
  "failed_to_kill": [],
  "services_started": true,
  "new_processes": [
    {"pid": 456789, "name": "python main.py", "port": 8000},
    {"pid": 456790, "name": "node vite", "port": 3000}
  ]
}
```

**Safety:** Only kills PIDs that were returned by the diagnose step. Validates each PID's command line matches expected patterns (python/node/vite/uvicorn) before killing — won't blindly kill arbitrary PIDs.

## Harden start.sh --dev

Add a pre-flight cleanup to the dev mode path in `scripts/start.sh`:

```bash
# Pre-flight: kill anything occupying our ports
for PORT in $BACKEND_PORT $FRONTEND_PORT; do
    PID=$(ss -tlnp "sport = :$PORT" 2>/dev/null | awk 'NR>1{match($0,/pid=([0-9]+)/,a); print a[1]}')
    if [ -n "$PID" ]; then
        echo "Killing existing process on port $PORT (PID $PID)"
        kill -9 "$PID" 2>/dev/null
        sleep 0.5
    fi
done
```

This prevents orphan accumulation from future sessions running `start.sh --dev`.

## Frontend: SystemPanel Services Tab

### Layout

Below the existing systemd services section, add a new section:

**"Dev Mode Processes"** with:
- A header with status indicator dot (green = healthy, yellow = unchecked, red = issues found)
- **Diagnose** button: calls `GET /api/system/dev-health`, populates the issues list
- Issues list: each entry shows process name, PID, port, start time, and a badge for the issue type
- **Repair** button: disabled until diagnose finds issues. On click, shows a confirmation listing the processes to be killed. Calls `POST /api/system/dev-repair`, shows result.
- After successful repair: auto-runs diagnose again to show the new healthy state.

### States
- **Initial**: Yellow dot, "Run diagnose to check dev processes" hint text, only Diagnose button enabled
- **Healthy**: Green dot, "All healthy" message, Repair button disabled
- **Issues found**: Red dot, issues list visible, both buttons enabled
- **Repairing**: Spinner on Repair button, both buttons disabled
- **Repair complete**: Auto-diagnose shows new state

## File Changes

### New files
- `backend/api/dev_health.py` — new API router with `/dev-health` and `/dev-repair` endpoints

### Modified files
- `backend/main.py` — register the new dev_health router
- `frontend/src/api/client.ts` — add `getDevHealth()` and `postDevRepair(pids)` methods
- `frontend/src/components/layout/SystemPanel.tsx` — add Dev Mode Processes section to Services tab
- `scripts/start.sh` — add pre-flight port cleanup to dev mode path

## Out of Scope
- Production/systemd service management (already exists)
- Auto-detection of dev vs production mode in the UI (both sections always visible)
- Scheduled/periodic health checks (manual trigger only)
