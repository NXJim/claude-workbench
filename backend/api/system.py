"""System management endpoints — restart, stop, status, logs.

Mode-aware: uses systemctl in production, direct process management in dev mode.
"""

import asyncio
import logging
import os
import signal
from typing import Optional

from fastapi import APIRouter, Query

from config import DEV_MODE, LOGS_DIR, PORT, FRONTEND_PORT, PROJECT_ROOT
from services.process_utils import (
    run_cmd,
    get_pids_on_port,
    process_start_time_iso,
    get_process_memory,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["system"])

# Service definitions — dev mode has separate backend/frontend, production has one combined service
_DEV_SERVICES = [
    {
        "id": "workbench-backend",
        "label": "Backend",
        "description": "FastAPI server that manages tmux sessions, WebSocket connections, and the database. Handles all API requests.",
    },
    {
        "id": "workbench-frontend",
        "label": "Frontend",
        "description": "Vite dev server that serves the React UI. Proxies API and WebSocket requests to the backend.",
    },
]

_PROD_SERVICES = [
    {
        "id": "claude-workbench",
        "label": "Workbench",
        "description": "FastAPI server serving the API and built frontend. Manages tmux sessions, WebSocket connections, and the database.",
    },
]

SERVICES = _DEV_SERVICES if DEV_MODE else _PROD_SERVICES
SERVICE_IDS = [s["id"] for s in SERVICES]

# Map service IDs to ports for dev mode process detection
_SERVICE_PORTS = {
    "workbench-backend": PORT,
    "workbench-frontend": FRONTEND_PORT,
    "claude-workbench": PORT,
}

# Map service IDs to log file names for dev mode
_SERVICE_LOG_FILES = {
    "workbench-backend": "backend.log",
    "workbench-frontend": "frontend.log",
    "claude-workbench": "backend.log",
}


@router.get("/mode")
async def get_mode():
    """Return the current run mode and service list so the frontend can adapt its UI."""
    return {"dev_mode": DEV_MODE, "services": SERVICES}


@router.get("/status")
async def get_status():
    """Get service status. Uses process scanning in dev mode, systemctl in production."""
    if DEV_MODE:
        return await _dev_status()
    return await _systemd_status()


async def _dev_status() -> dict:
    """Get service status by scanning ports for running processes."""
    results = {}
    for svc in SERVICE_IDS:
        port = _SERVICE_PORTS[svc]
        procs = await get_pids_on_port(port)

        if svc == "workbench-backend":
            # We know we're running (we're serving this request), so report ourselves
            my_pid = os.getpid()
            results[svc] = {
                "active": "active",
                "state": "running",
                "sub_state": "dev",
                "pid": str(my_pid),
                "started_at": process_start_time_iso(my_pid),
                "memory": str(get_process_memory(my_pid)),
            }
        elif procs:
            # Use the first (or newest) process found on the port
            pid = procs[0]["pid"]
            results[svc] = {
                "active": "active",
                "state": "running",
                "sub_state": "dev",
                "pid": str(pid),
                "started_at": process_start_time_iso(pid),
                "memory": str(get_process_memory(pid)),
            }
        else:
            results[svc] = {
                "active": "inactive",
                "state": "dead",
                "sub_state": "dead",
                "pid": "0",
                "started_at": "",
                "memory": "0",
            }

    return results


async def _systemd_status() -> dict:
    """Get service status from systemd (production mode)."""
    results = {}
    for svc in SERVICE_IDS:
        rc, stdout, stderr = await run_cmd(["systemctl", "is-active", svc], timeout=10)
        active = stdout.strip()

        _, detail, _ = await run_cmd([
            "systemctl", "show", svc,
            "--property=ActiveState,SubState,MainPID,ActiveEnterTimestamp,MemoryCurrent",
        ], timeout=10)
        props = {}
        for line in detail.strip().split("\n"):
            if "=" in line:
                k, v = line.split("=", 1)
                props[k] = v

        results[svc] = {
            "active": active,
            "state": props.get("ActiveState", "unknown"),
            "sub_state": props.get("SubState", "unknown"),
            "pid": props.get("MainPID", "0"),
            "started_at": props.get("ActiveEnterTimestamp", ""),
            "memory": props.get("MemoryCurrent", "0"),
        }

    return results


@router.post("/restart")
async def restart_services(service: Optional[str] = Query(None, description="Specific service, or omit for both")):
    """Restart workbench services. Backend restarts itself last."""
    targets = [service] if service and service in SERVICE_IDS else SERVICE_IDS

    if DEV_MODE:
        return await _dev_restart(targets)
    return await _systemd_restart(targets)


async def _dev_restart(targets: list[str]) -> dict:
    """Restart dev mode services by launching a new start.sh --dev instance.

    start.sh --dev pre-flight cleanup handles killing existing processes on
    ports 8000/3000, so we just need to launch it and let it handle the rest.
    For frontend-only restart, we still restart everything to avoid triggering
    start.sh's trap (which would kill the backend too).
    """
    start_script = PROJECT_ROOT.parent / "scripts" / "start.sh"
    if not start_script.exists():
        return {"status": "error", "message": "start.sh not found", "targets": targets}

    # Launch new start.sh --dev detached — its pre-flight will clean up old processes
    await asyncio.create_subprocess_exec(
        str(start_script), "--dev",
        cwd=str(PROJECT_ROOT.parent),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )

    if "workbench-backend" in targets:
        # Kill the reloader parent (os.getppid()) not just the worker (os.getpid()).
        # With uvicorn --reload, killing only the worker causes the reloader to respawn it.
        reloader_pid = os.getppid()
        async def _delayed_self_kill():
            await asyncio.sleep(0.5)
            os.kill(reloader_pid, signal.SIGTERM)

        asyncio.create_task(_delayed_self_kill())

    return {
        "status": "restarting",
        "message": "Dev services restarting. Page will reconnect automatically.",
        "targets": targets,
    }


async def _systemd_restart(targets: list[str]) -> dict:
    """Restart services via systemctl (production mode)."""
    # If restarting the backend, restart frontend first, then backend
    if "workbench-backend" in targets and len(targets) > 1:
        rc, out, err = await run_cmd(["sudo", "systemctl", "restart", "workbench-frontend"], timeout=10)
        if rc != 0:
            return {"status": "error", "message": f"Frontend restart failed: {err}"}

        async def _delayed_backend_restart():
            await asyncio.sleep(0.5)
            await run_cmd(["sudo", "systemctl", "restart", "workbench-backend"], timeout=10)

        asyncio.create_task(_delayed_backend_restart())
        return {
            "status": "restarting",
            "message": "Both services restarting. Page will reconnect automatically.",
            "targets": targets,
        }
    else:
        results = {}
        for svc in targets:
            rc, out, err = await run_cmd(["sudo", "systemctl", "restart", svc], timeout=10)
            results[svc] = "ok" if rc == 0 else f"error: {err.strip()}"

        if "workbench-backend" in targets:
            async def _delayed_restart():
                await asyncio.sleep(0.5)
                await run_cmd(["sudo", "systemctl", "restart", "workbench-backend"], timeout=10)
            asyncio.create_task(_delayed_restart())
            return {"status": "restarting", "message": "Backend restarting.", "targets": targets}

        return {"status": "ok", "results": results, "targets": targets}


@router.post("/stop")
async def stop_services(service: Optional[str] = Query(None, description="Specific service, or omit for both")):
    """Stop workbench services."""
    targets = [service] if service and service in SERVICE_IDS else SERVICE_IDS

    if DEV_MODE:
        return await _dev_stop(targets)
    return await _systemd_stop(targets)


async def _dev_stop(targets: list[str]) -> dict:
    """Stop dev mode services by sending SIGTERM to processes on their ports."""
    results = {}

    # Stop frontend first if requested
    if "workbench-frontend" in targets:
        frontend_procs = await get_pids_on_port(FRONTEND_PORT)
        errors = []
        for p in frontend_procs:
            try:
                os.kill(p["pid"], signal.SIGTERM)
            except (ProcessLookupError, PermissionError) as e:
                errors.append(f"PID {p['pid']}: {e}")
        results["workbench-frontend"] = f"error: {'; '.join(errors)}" if errors else "ok"

    if "workbench-backend" in targets:
        results["workbench-backend"] = "ok"
        # Kill the reloader parent, not just the worker (see _dev_restart comment)
        reloader_pid = os.getppid()
        async def _delayed_self_kill():
            await asyncio.sleep(0.5)
            os.kill(reloader_pid, signal.SIGTERM)

        asyncio.create_task(_delayed_self_kill())

    return {"status": "ok", "results": results, "targets": targets}


async def _systemd_stop(targets: list[str]) -> dict:
    """Stop services via systemctl (production mode)."""
    results = {}
    for svc in targets:
        rc, out, err = await run_cmd(["sudo", "systemctl", "stop", svc], timeout=10)
        results[svc] = "ok" if rc == 0 else f"error: {err.strip()}"
    return {"status": "ok", "results": results, "targets": targets}


@router.get("/logs")
async def get_logs(
    service: str = Query(SERVICE_IDS[0], description="Service name"),
    lines: int = Query(100, ge=10, le=1000, description="Number of lines"),
):
    """Fetch recent logs. Reads log files in dev mode, journalctl in production."""
    if service not in SERVICE_IDS:
        return {"error": f"Unknown service: {service}"}

    if DEV_MODE:
        return _dev_logs(service, lines)
    return await _systemd_logs(service, lines)


def _dev_logs(service: str, lines: int) -> dict:
    """Read last N lines from dev mode log files."""
    log_filename = _SERVICE_LOG_FILES.get(service)
    if not log_filename:
        return {"service": service, "lines": ["Unknown service"], "count": 0}

    log_file = LOGS_DIR / log_filename
    if not log_file.exists():
        return {
            "service": service,
            "lines": [f"No log file found at {log_file}. Logs are created on next start.sh --dev restart."],
            "count": 0,
        }

    try:
        all_lines = log_file.read_text().splitlines()
        tail = all_lines[-lines:]
        return {"service": service, "lines": tail, "count": len(tail)}
    except Exception as e:
        return {"error": str(e), "lines": []}


async def _systemd_logs(service: str, lines: int) -> dict:
    """Fetch logs from systemd journal (production mode)."""
    rc, stdout, stderr = await run_cmd(
        ["journalctl", "-u", service, "--no-pager", "-n", str(lines), "--output=short-iso"],
        timeout=15,
    )
    if rc != 0:
        return {"error": stderr.strip(), "lines": []}

    log_lines = stdout.strip().split("\n") if stdout.strip() else []
    return {"service": service, "lines": log_lines, "count": len(log_lines)}
