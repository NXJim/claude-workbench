# Dev Mode Health & Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-step diagnose/repair flow to the SystemPanel Services tab that detects and fixes orphaned backend processes, duplicate Vite instances, and stale start.sh processes in dev mode.

**Architecture:** New backend API router (`dev_health.py`) with two endpoints — GET for diagnosis, POST for repair. Frontend adds a "Dev Mode Processes" section below the existing systemd services in SystemPanel. The `start.sh` script gets pre-flight port cleanup to prevent orphan accumulation.

**Tech Stack:** FastAPI (backend), React + TypeScript + Tailwind (frontend), bash (start.sh)

---

### Task 1: Harden start.sh with pre-flight port cleanup

**Files:**
- Modify: `scripts/start.sh:43-55` (dev mode section, before backend/frontend start)

- [ ] **Step 1: Add pre-flight cleanup to dev mode path**

Insert between line 48 (`echo ""`) and line 50 (`echo "Starting backend..."`) in `scripts/start.sh`:

```bash
    # Pre-flight: kill anything occupying our ports to prevent orphan accumulation
    for PORT in $BACKEND_PORT $FRONTEND_PORT; do
        EXISTING_PID=$(ss -tlnp "sport = :$PORT" 2>/dev/null | awk 'NR>1{match($0,/pid=([0-9]+)/,a); print a[1]}' | head -1)
        if [ -n "$EXISTING_PID" ]; then
            echo "Killing existing process on port $PORT (PID $EXISTING_PID)"
            kill -9 "$EXISTING_PID" 2>/dev/null
            sleep 0.5
        fi
    done

    # Also kill any stale start.sh --dev processes (but not ourselves)
    for PID in $(pgrep -f 'start\.sh --dev' 2>/dev/null); do
        if [ "$PID" != "$$" ]; then
            echo "Killing stale start.sh process (PID $PID)"
            kill -9 "$PID" 2>/dev/null
        fi
    done
```

- [ ] **Step 2: Verify the script is syntactically valid**

Run: `bash -n scripts/start.sh`
Expected: no output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add scripts/start.sh
git commit -m "Harden start.sh --dev with pre-flight port cleanup

Kills existing processes on backend/frontend ports and stale start.sh
instances before starting, preventing orphan accumulation from crashed
or abandoned dev sessions."
```

---

### Task 2: Backend dev health diagnosis endpoint

**Files:**
- Create: `backend/api/dev_health.py`
- Modify: `backend/main.py:34` (add router import) and `backend/main.py:91` (register router)

- [ ] **Step 1: Create the dev_health router with GET /dev-health**

Create `backend/api/dev_health.py`:

```python
"""Dev mode process health check and repair endpoints.

These endpoints scan for orphaned/duplicate processes that accumulate
when dev mode (start.sh --dev) is started multiple times without cleanup.
"""

import asyncio
import logging
import os
import signal
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import PORT, FRONTEND_PORT, PROJECT_ROOT

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["system"])


class ProcessIssue(BaseModel):
    """A single problematic process found during diagnosis."""
    pid: int
    name: str
    port: int | None
    issue: str  # "orphaned", "duplicate", "stale", "port_conflict"
    description: str


class DevHealthResponse(BaseModel):
    """Result of a dev mode health check."""
    healthy: bool
    issues: list[ProcessIssue]
    summary: dict[str, int]


class DevRepairRequest(BaseModel):
    """PIDs to kill, sourced from a prior diagnose call."""
    pids: list[int]


class DevRepairResponse(BaseModel):
    """Result of a dev mode repair action."""
    success: bool
    killed: list[int]
    failed_to_kill: list[int]
    services_started: bool
    message: str


async def _run(cmd: list[str], timeout: int = 5) -> tuple[int, str, str]:
    """Run a shell command and return (returncode, stdout, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return -1, "", "Command timed out"
    return proc.returncode, stdout.decode(), stderr.decode()


async def _get_pids_on_port(port: int) -> list[dict]:
    """Find all PIDs listening on a given TCP port.

    Returns list of {pid, cmdline} dicts. Uses ss (socket statistics)
    which is faster and more reliable than lsof for this purpose.
    """
    rc, stdout, _ = await _run(["ss", "-tlnp", f"sport = :{port}"])
    if rc != 0 or not stdout.strip():
        return []

    results = []
    seen_pids = set()
    for line in stdout.strip().split("\n")[1:]:  # skip header
        # Extract pid from "users:(("python",pid=123456,fd=3))"
        import re
        for match in re.finditer(r'pid=(\d+)', line):
            pid = int(match.group(1))
            if pid in seen_pids:
                continue
            seen_pids.add(pid)
            # Read the process command line
            cmdline = ""
            try:
                cmdline = Path(f"/proc/{pid}/cmdline").read_text().replace("\x00", " ").strip()
            except (FileNotFoundError, PermissionError):
                pass
            results.append({"pid": pid, "cmdline": cmdline})
    return results


async def _find_processes_by_pattern(pattern: str) -> list[dict]:
    """Find processes matching a grep pattern via pgrep.

    Returns list of {pid, cmdline} dicts. Excludes the current process.
    """
    rc, stdout, _ = await _run(["pgrep", "-f", pattern])
    if rc != 0 or not stdout.strip():
        return []

    my_pid = os.getpid()
    results = []
    for line in stdout.strip().split("\n"):
        pid = int(line.strip())
        if pid == my_pid:
            continue
        cmdline = ""
        try:
            cmdline = Path(f"/proc/{pid}/cmdline").read_text().replace("\x00", " ").strip()
        except (FileNotFoundError, PermissionError):
            pass
        results.append({"pid": pid, "cmdline": cmdline})
    return results


def _process_start_time(pid: int) -> str:
    """Get human-readable start time for a process from /proc/[pid]/stat."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        # Field 22 is starttime in clock ticks since boot
        fields = stat.split()
        starttime_ticks = int(fields[21])
        # Get system boot time
        with open("/proc/uptime") as f:
            uptime_secs = float(f.read().split()[0])
        clock_ticks = os.sysconf("SC_CLK_TCK")
        start_secs_ago = uptime_secs - (starttime_ticks / clock_ticks)
        if start_secs_ago < 60:
            return f"{int(start_secs_ago)}s ago"
        elif start_secs_ago < 3600:
            return f"{int(start_secs_ago / 60)}m ago"
        elif start_secs_ago < 86400:
            return f"{int(start_secs_ago / 3600)}h ago"
        else:
            return f"{int(start_secs_ago / 86400)}d ago"
    except Exception:
        return "unknown"


def _is_workbench_process(cmdline: str) -> bool:
    """Check if a command line looks like a workbench-related process."""
    workbench_indicators = [
        "claude-workbench",
        str(PROJECT_ROOT),
        "main:app",
        "main.py",
    ]
    return any(indicator in cmdline for indicator in workbench_indicators)


def _short_name(cmdline: str) -> str:
    """Extract a short display name from a full command line."""
    if "vite" in cmdline:
        return "node vite"
    if "uvicorn" in cmdline:
        return "uvicorn main:app"
    if "python main.py" in cmdline or "python3 main.py" in cmdline:
        return "python main.py"
    if "start.sh" in cmdline:
        return "start.sh --dev"
    # Fallback: first ~40 chars
    return cmdline[:40] + ("..." if len(cmdline) > 40 else "")


@router.get("/dev-health", response_model=DevHealthResponse)
async def dev_health_check():
    """Diagnose dev mode process health.

    Scans for orphaned/duplicate/stale processes on the backend and
    frontend ports, plus leftover start.sh instances. Returns a list
    of issues with PIDs that the repair endpoint can kill.
    """
    issues: list[ProcessIssue] = []

    # 1. Check port 8000 (backend)
    backend_procs = await _get_pids_on_port(PORT)
    my_pid = os.getpid()
    # Filter out ourselves (the running backend)
    other_backend = [p for p in backend_procs if p["pid"] != my_pid]
    if len(backend_procs) > 1:
        # Multiple processes on the backend port — the extras are duplicates
        for p in other_backend:
            issues.append(ProcessIssue(
                pid=p["pid"],
                name=_short_name(p["cmdline"]),
                port=PORT,
                issue="duplicate",
                description=f"Duplicate backend on port {PORT} (PID {p['pid']}, started {_process_start_time(p['pid'])})",
            ))
    elif other_backend and not backend_procs:
        # Something on our port that isn't us
        for p in other_backend:
            issues.append(ProcessIssue(
                pid=p["pid"],
                name=_short_name(p["cmdline"]),
                port=PORT,
                issue="port_conflict",
                description=f"Unknown process on port {PORT}: {_short_name(p['cmdline'])}",
            ))

    # 2. Check port 3000 (frontend / Vite)
    frontend_procs = await _get_pids_on_port(FRONTEND_PORT)
    if len(frontend_procs) > 1:
        # Multiple Vite instances — all but the newest are duplicates
        # Sort by PID (higher = newer), keep the last one as "current"
        sorted_procs = sorted(frontend_procs, key=lambda p: p["pid"])
        for p in sorted_procs[:-1]:
            issues.append(ProcessIssue(
                pid=p["pid"],
                name=_short_name(p["cmdline"]),
                port=FRONTEND_PORT,
                issue="duplicate",
                description=f"Duplicate Vite on port {FRONTEND_PORT} (PID {p['pid']}, started {_process_start_time(p['pid'])})",
            ))

    # 3. Check for stale start.sh --dev processes
    start_sh_procs = await _find_processes_by_pattern(r"start\.sh --dev")
    if len(start_sh_procs) > 1:
        # Multiple start.sh — all but the newest are stale
        sorted_procs = sorted(start_sh_procs, key=lambda p: p["pid"])
        for p in sorted_procs[:-1]:
            issues.append(ProcessIssue(
                pid=p["pid"],
                name="start.sh --dev",
                port=None,
                issue="stale",
                description=f"Stale start.sh process (PID {p['pid']}, started {_process_start_time(p['pid'])})",
            ))

    # 4. Check for orphaned Vite processes (workbench-specific, not on port 3000)
    vite_procs = await _find_processes_by_pattern(r"vite --host 0\.0\.0\.0")
    # Filter to workbench-related only
    vite_procs = [p for p in vite_procs if _is_workbench_process(p["cmdline"])]
    # Subtract any already accounted for on port 3000
    port_pids = {p["pid"] for p in frontend_procs}
    orphaned_vite = [p for p in vite_procs if p["pid"] not in port_pids]
    for p in orphaned_vite:
        issues.append(ProcessIssue(
            pid=p["pid"],
            name="node vite (orphaned)",
            port=None,
            issue="orphaned",
            description=f"Orphaned Vite process not serving any port (PID {p['pid']}, started {_process_start_time(p['pid'])})",
        ))

    # Build summary counts
    port_8000_count = len(backend_procs)
    port_3000_count = len(frontend_procs)
    start_sh_count = len(start_sh_procs)
    orphaned_count = len([i for i in issues if i.issue == "orphaned"])

    healthy = len(issues) == 0

    return DevHealthResponse(
        healthy=healthy,
        issues=issues,
        summary={
            "port_8000_count": port_8000_count,
            "port_3000_count": port_3000_count,
            "start_sh_count": start_sh_count,
            "orphaned_count": orphaned_count,
        },
    )


@router.post("/dev-repair", response_model=DevRepairResponse)
async def dev_repair(req: DevRepairRequest):
    """Kill identified problem processes and restart dev services.

    Only kills PIDs whose command line matches known workbench patterns
    (python, node/vite, start.sh) — refuses to kill arbitrary processes.
    After cleanup, launches start.sh --dev and polls for service startup.
    """
    if not req.pids:
        raise HTTPException(status_code=400, detail="No PIDs provided")

    killed: list[int] = []
    failed: list[int] = []

    # Validate and kill each PID
    for pid in req.pids:
        # Safety: verify command line matches expected patterns
        try:
            cmdline = Path(f"/proc/{pid}/cmdline").read_text().replace("\x00", " ").strip()
        except (FileNotFoundError, PermissionError):
            # Process already gone
            killed.append(pid)
            continue

        if not _is_workbench_process(cmdline):
            logger.warning("Refusing to kill PID %d — not a workbench process: %s", pid, cmdline[:80])
            failed.append(pid)
            continue

        # Send SIGTERM first
        try:
            os.kill(pid, signal.SIGTERM)
            logger.info("Sent SIGTERM to PID %d (%s)", pid, _short_name(cmdline))
        except ProcessLookupError:
            killed.append(pid)
            continue
        except PermissionError:
            logger.warning("Permission denied killing PID %d", pid)
            failed.append(pid)
            continue

    # Wait for processes to exit gracefully
    await asyncio.sleep(1.0)

    # SIGKILL any survivors
    for pid in req.pids:
        if pid in killed or pid in failed:
            continue
        try:
            os.kill(pid, signal.SIGKILL)
            logger.info("Sent SIGKILL to PID %d", pid)
            killed.append(pid)
        except ProcessLookupError:
            # Already exited after SIGTERM
            killed.append(pid)
        except PermissionError:
            failed.append(pid)

    await asyncio.sleep(0.5)

    # Restart dev services via start.sh --dev
    project_dir = PROJECT_ROOT.parent  # backend/ -> project root
    start_script = project_dir / "scripts" / "start.sh"

    services_started = False
    if start_script.exists():
        # Launch detached — we don't want to wait for it
        proc = await asyncio.create_subprocess_exec(
            str(start_script), "--dev",
            cwd=str(project_dir),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            # Detach from our process group so it survives if we restart
            start_new_session=True,
        )
        logger.info("Launched start.sh --dev (PID %d)", proc.pid)

        # Poll for services to come up (check ports)
        for attempt in range(10):
            await asyncio.sleep(0.5)
            backend_up = len(await _get_pids_on_port(PORT)) > 0
            frontend_up = len(await _get_pids_on_port(FRONTEND_PORT)) > 0
            if backend_up and frontend_up:
                services_started = True
                break

    message = ""
    if killed and services_started:
        message = f"Killed {len(killed)} process(es) and restarted dev services."
    elif killed and not services_started:
        message = f"Killed {len(killed)} process(es) but services may still be starting."
    elif not killed:
        message = "No processes were killed."

    if failed:
        message += f" Failed to kill {len(failed)} process(es) — not workbench processes."

    return DevRepairResponse(
        success=len(failed) == 0 and services_started,
        killed=killed,
        failed_to_kill=failed,
        services_started=services_started,
        message=message,
    )
```

- [ ] **Step 2: Register the router in main.py**

In `backend/main.py`, add the import after line 34 (`from api.system import router as system_router`):

```python
from api.dev_health import router as dev_health_router
```

And add the router registration after line 91 (`app.include_router(health_router, prefix="/api")`):

```python
app.include_router(dev_health_router, prefix="/api")
```

- [ ] **Step 3: Verify the backend starts without import errors**

Run: `cd backend && source venv/bin/activate && python -c "from api.dev_health import router; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/api/dev_health.py backend/main.py
git commit -m "Add dev mode health check and repair API endpoints

GET /api/system/dev-health scans for orphaned, duplicate, and stale
processes on the backend/frontend ports. POST /api/system/dev-repair
kills identified PIDs (with safety validation) and restarts start.sh."
```

---

### Task 3: Frontend API client methods

**Files:**
- Modify: `frontend/src/api/client.ts:195` (after `getServiceLogs`)

- [ ] **Step 1: Add TypeScript interfaces and API methods**

After the `getServiceLogs` method (line 195) in `frontend/src/api/client.ts`, add:

```typescript
  // Dev mode health check
  getDevHealth: () =>
    request<{
      healthy: boolean;
      issues: Array<{
        pid: number;
        name: string;
        port: number | null;
        issue: string;
        description: string;
      }>;
      summary: {
        port_8000_count: number;
        port_3000_count: number;
        start_sh_count: number;
        orphaned_count: number;
      };
    }>('/system/dev-health'),
  devRepair: (pids: number[]) =>
    request<{
      success: boolean;
      killed: number[];
      failed_to_kill: number[];
      services_started: boolean;
      message: string;
    }>('/system/dev-repair', { method: 'POST', body: JSON.stringify({ pids }) }),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors related to `client.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "Add getDevHealth and devRepair API client methods"
```

---

### Task 4: Frontend Dev Mode Processes section in SystemPanel

**Files:**
- Modify: `frontend/src/components/layout/SystemPanel.tsx:827-1084` (SystemPanel component, Services tab)

This is the largest task. The new section goes inside the Services tab, after the action message div (line 1083) and before the closing `</div>` of the services tab (line 1084).

- [ ] **Step 1: Add state variables for dev health**

In the `SystemPanel` component, after line 833 (`const [actionMessage, setActionMessage] = useState<string | null>(null);`), add:

```typescript
  // Dev mode health state
  const [devHealth, setDevHealth] = useState<{
    healthy: boolean;
    issues: Array<{ pid: number; name: string; port: number | null; issue: string; description: string }>;
    summary: { port_8000_count: number; port_3000_count: number; start_sh_count: number; orphaned_count: number };
  } | null>(null);
  const [devDiagnosing, setDevDiagnosing] = useState(false);
  const [devRepairing, setDevRepairing] = useState(false);
  const [devMessage, setDevMessage] = useState<string | null>(null);
```

- [ ] **Step 2: Add diagnose and repair handler functions**

After the `handleStop` function (ends at line 941), add:

```typescript
  const handleDevDiagnose = async () => {
    setDevDiagnosing(true);
    setDevMessage(null);
    try {
      const data = await api.getDevHealth();
      setDevHealth(data);
      if (data.healthy) {
        setDevMessage('All dev processes healthy.');
      }
    } catch (e) {
      setDevMessage(`Diagnose failed: ${(e as Error).message}`);
      setDevHealth(null);
    } finally {
      setDevDiagnosing(false);
    }
  };

  const handleDevRepair = async () => {
    if (!devHealth?.issues.length) return;

    const pids = devHealth.issues.map((i) => i.pid);
    const ok = await confirmDialog({
      title: 'Repair dev processes?',
      message: `This will kill ${pids.length} process(es) and restart dev services:\n\n${devHealth.issues.map((i) => `PID ${i.pid} — ${i.name}`).join('\n')}`,
      confirmLabel: 'Repair',
      confirmVariant: 'warning',
    });
    if (!ok) return;

    setDevRepairing(true);
    setDevMessage(null);
    try {
      const res = await api.devRepair(pids);
      setDevMessage(res.message);
      // Re-diagnose to show updated state
      setTimeout(handleDevDiagnose, 2000);
    } catch (e) {
      setDevMessage(`Repair failed: ${(e as Error).message}`);
    } finally {
      setDevRepairing(false);
    }
  };
```

- [ ] **Step 3: Add the Dev Mode Processes UI section**

Inside the Services tab (`{tab === 'status' && (...)}`), after the `actionMessage` div (line 1082) and before the closing `</div>` (line 1083), add this section:

```tsx
              {/* Dev Mode Processes */}
              <div className="border-t border-surface-200 dark:border-surface-700 pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      devHealth === null
                        ? 'bg-yellow-400'
                        : devHealth.healthy
                          ? 'bg-green-400'
                          : 'bg-red-400'
                    }`} />
                    <span className="text-sm font-semibold">Dev Mode Processes</span>
                    {devHealth && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        devHealth.healthy
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}>
                        {devHealth.healthy ? 'healthy' : `${devHealth.issues.length} issue${devHealth.issues.length !== 1 ? 's' : ''}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleDevDiagnose}
                      disabled={devDiagnosing || devRepairing}
                      className="text-xs px-2 py-1 rounded bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-50"
                    >
                      {devDiagnosing ? 'Scanning...' : 'Diagnose'}
                    </button>
                    <button
                      onClick={handleDevRepair}
                      disabled={devRepairing || devDiagnosing || !devHealth?.issues.length}
                      className="text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50"
                    >
                      {devRepairing ? 'Repairing...' : 'Repair'}
                    </button>
                  </div>
                </div>

                {/* Hint text when not yet diagnosed */}
                {devHealth === null && !devDiagnosing && (
                  <p className="text-xs text-surface-400">Click Diagnose to scan for orphaned or duplicate dev processes.</p>
                )}

                {/* Issues list */}
                {devHealth && devHealth.issues.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {devHealth.issues.map((issue) => (
                      <div key={issue.pid} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-surface-50 dark:bg-surface-700/50 rounded">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${
                          issue.issue === 'duplicate'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : issue.issue === 'orphaned'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                              : issue.issue === 'stale'
                                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                                : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                        }`}>
                          {issue.issue}
                        </span>
                        <span className="text-surface-600 dark:text-surface-300 font-mono">{issue.name}</span>
                        {issue.port && <span className="text-surface-400">:{issue.port}</span>}
                        <span className="text-surface-400 ml-auto">PID {issue.pid}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary when healthy */}
                {devHealth?.healthy && (
                  <div className="text-xs text-surface-400 space-y-0.5">
                    <p>Port {PORT_LABELS.backend}: {devHealth.summary.port_8000_count} process(es) | Port {PORT_LABELS.frontend}: {devHealth.summary.port_3000_count} process(es) | start.sh: {devHealth.summary.start_sh_count}</p>
                  </div>
                )}

                {/* Dev action message */}
                {devMessage && (
                  <div className={`text-sm rounded-lg px-3 py-2 mt-2 ${
                    devMessage.includes('failed') || devMessage.includes('Error')
                      ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                      : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  }`}>
                    {devMessage}
                  </div>
                )}

                <p className="text-xs text-surface-400 mt-2">
                  <strong>Diagnose</strong> — Scan for orphaned backends, duplicate Vite instances, stale start.sh processes.{' '}
                  <strong>Repair</strong> — Kill identified processes and restart via start.sh --dev.
                </p>
              </div>
```

- [ ] **Step 4: Add the PORT_LABELS constant**

Above the `SystemPanel` component (before line 827), add:

```typescript
/** Port labels for dev health summary display. */
const PORT_LABELS = { backend: '8000', frontend: '3000' } as const;
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/layout/SystemPanel.tsx
git commit -m "Add Dev Mode Processes section to SystemPanel Services tab

Two-step diagnose/repair UI: scan for orphaned, duplicate, and stale
dev processes, then kill and restart with confirmation. Shows status
dot (yellow/green/red), issue list with badges, and summary counts."
```

---

### Task 5: Manual integration test

**Files:** None (verification only)

- [ ] **Step 1: Verify backend starts cleanly with the new router**

Run: `cd /home/nomax/projects/tools/claude-workbench && curl -s http://localhost:8000/api/system/dev-health | python3 -m json.tool`
Expected: JSON with `healthy`, `issues`, `summary` fields. Should show 0 or more issues depending on current process state.

- [ ] **Step 2: Verify frontend loads and the Dev Mode Processes section appears**

Use Playwright MCP to navigate to the Workbench, open the gear icon (SystemPanel), and confirm:
1. The Services tab shows the existing systemd services section
2. Below it, "Dev Mode Processes" section with yellow dot and Diagnose button
3. Click Diagnose — should populate with results
4. If issues found, Repair button should become enabled

- [ ] **Step 3: Clean up any screenshots from verification**

```bash
rm -f /home/nomax/projects/tools/claude-workbench/*.png /home/nomax/*.png
```

- [ ] **Step 4: Update CHANGELOG.md**

Add an entry under today's date documenting the new feature.

- [ ] **Step 5: Final commit**

```bash
git add CHANGELOG.md
git commit -m "Update changelog for dev mode health check feature"
```
