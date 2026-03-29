"""Dev mode process health check and repair endpoints.

These endpoints scan for orphaned/duplicate processes that accumulate
when dev mode (start.sh --dev) is started multiple times without cleanup.
"""

import asyncio
import logging
import os
import re
import signal
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
    seen_pids: set[int] = set()
    for line in stdout.strip().split("\n")[1:]:  # skip header
        # Extract pid from "users:(("python",pid=123456,fd=3))"
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
