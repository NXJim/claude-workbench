"""Dev mode process health check and repair endpoints.

These endpoints scan for orphaned/duplicate processes that accumulate
when dev mode (start.sh --dev) is started multiple times without cleanup.
"""

import asyncio
import logging
import os
import signal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import PORT, FRONTEND_PORT, PROJECT_ROOT
from services.process_utils import (
    get_pids_on_port,
    find_processes_by_pattern,
    process_start_time_human,
    is_workbench_process,
    short_name,
    read_process_cmdline,
)

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


@router.get("/dev-health", response_model=DevHealthResponse)
async def dev_health_check():
    """Diagnose dev mode process health.

    Scans for orphaned/duplicate/stale processes on the backend and
    frontend ports, plus leftover start.sh instances. Returns a list
    of issues with PIDs that the repair endpoint can kill.
    """
    issues: list[ProcessIssue] = []

    # 1. Check port 8000 (backend)
    backend_procs = await get_pids_on_port(PORT)
    my_pid = os.getpid()
    # With uvicorn --reload, there's a reloader parent (our ppid) and the server
    # worker (us). Both listen on the same port. Exclude both from "other" list.
    my_ppid = os.getppid()
    own_pids = {my_pid, my_ppid}
    other_backend = [p for p in backend_procs if p["pid"] not in own_pids and p["cmdline"]]
    if other_backend:
        # Processes on the backend port that aren't part of our uvicorn instance
        # (skip processes with empty cmdline — likely transient reload artifacts)
        for p in other_backend:
            issues.append(ProcessIssue(
                pid=p["pid"],
                name=short_name(p["cmdline"]),
                port=PORT,
                issue="duplicate",
                description=f"Duplicate backend on port {PORT} (PID {p['pid']}, started {process_start_time_human(p['pid'])})",
            ))

    # 2. Check port 3000 (frontend / Vite)
    frontend_procs = await get_pids_on_port(FRONTEND_PORT)
    if len(frontend_procs) > 1:
        # Multiple Vite instances — all but the newest are duplicates
        # Sort by PID (higher = newer), keep the last one as "current"
        sorted_procs = sorted(frontend_procs, key=lambda p: p["pid"])
        for p in sorted_procs[:-1]:
            issues.append(ProcessIssue(
                pid=p["pid"],
                name=short_name(p["cmdline"]),
                port=FRONTEND_PORT,
                issue="duplicate",
                description=f"Duplicate Vite on port {FRONTEND_PORT} (PID {p['pid']}, started {process_start_time_human(p['pid'])})",
            ))

    # 3. Check for stale start.sh --dev processes
    start_sh_procs = await find_processes_by_pattern(r"start\.sh --dev")
    if len(start_sh_procs) > 1:
        # Multiple start.sh — all but the newest are stale
        sorted_procs = sorted(start_sh_procs, key=lambda p: p["pid"])
        for p in sorted_procs[:-1]:
            issues.append(ProcessIssue(
                pid=p["pid"],
                name="start.sh --dev",
                port=None,
                issue="stale",
                description=f"Stale start.sh process (PID {p['pid']}, started {process_start_time_human(p['pid'])})",
            ))

    # 4. Check for orphaned Vite processes (workbench-specific, not on port 3000)
    vite_procs = await find_processes_by_pattern(r"vite --host 0\.0\.0\.0")
    # Filter to workbench-related only
    vite_procs = [p for p in vite_procs if is_workbench_process(p["cmdline"])]
    # Subtract any already accounted for on port 3000
    port_pids = {p["pid"] for p in frontend_procs}
    orphaned_vite = [p for p in vite_procs if p["pid"] not in port_pids]
    for p in orphaned_vite:
        issues.append(ProcessIssue(
            pid=p["pid"],
            name="node vite (orphaned)",
            port=None,
            issue="orphaned",
            description=f"Orphaned Vite process not serving any port (PID {p['pid']}, started {process_start_time_human(p['pid'])})",
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
        cmdline = read_process_cmdline(pid)
        if not cmdline:
            # Process already gone
            killed.append(pid)
            continue

        if not is_workbench_process(cmdline):
            logger.warning("Refusing to kill PID %d — not a workbench process: %s", pid, cmdline[:80])
            failed.append(pid)
            continue

        # Send SIGTERM first
        try:
            os.kill(pid, signal.SIGTERM)
            logger.info("Sent SIGTERM to PID %d (%s)", pid, short_name(cmdline))
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
            backend_up = len(await get_pids_on_port(PORT)) > 0
            frontend_up = len(await get_pids_on_port(FRONTEND_PORT)) > 0
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
