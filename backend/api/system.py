"""System management endpoints — restart, stop, status, logs."""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["system"])

SERVICES = ["claude-workbench"]


async def _run(cmd: list[str], timeout: int = 10) -> tuple[int, str, str]:
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


@router.get("/status")
async def get_status():
    """Get systemd service status for the workbench service."""
    results = {}
    for svc in SERVICES:
        rc, stdout, stderr = await _run(["systemctl", "is-active", svc])
        active = stdout.strip()

        # Get uptime/details
        _, detail, _ = await _run([
            "systemctl", "show", svc,
            "--property=ActiveState,SubState,MainPID,ActiveEnterTimestamp,MemoryCurrent",
        ])
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
async def restart_services(service: Optional[str] = Query(None, description="Specific service to restart")):
    """Restart workbench service. Schedules restart after response is sent."""
    targets = [service] if service and service in SERVICES else SERVICES

    # Schedule restart after response so the HTTP reply gets sent first
    async def _delayed_restart():
        await asyncio.sleep(0.5)
        for svc in targets:
            await _run(["sudo", "systemctl", "restart", svc])

    asyncio.create_task(_delayed_restart())
    return {
        "status": "restarting",
        "message": "Service restarting. Page will reconnect automatically.",
        "targets": targets,
    }


@router.post("/stop")
async def stop_services(service: Optional[str] = Query(None, description="Specific service to stop")):
    """Stop workbench service."""
    targets = [service] if service and service in SERVICES else SERVICES
    results = {}
    for svc in targets:
        rc, out, err = await _run(["sudo", "systemctl", "stop", svc])
        results[svc] = "ok" if rc == 0 else f"error: {err.strip()}"
    return {"status": "ok", "results": results, "targets": targets}


@router.get("/logs")
async def get_logs(
    service: str = Query("claude-workbench", description="Service name"),
    lines: int = Query(100, ge=10, le=1000, description="Number of lines"),
):
    """Fetch recent journal logs for a service."""
    if service not in SERVICES:
        return {"error": f"Unknown service: {service}"}

    rc, stdout, stderr = await _run(
        ["journalctl", "-u", service, "--no-pager", "-n", str(lines), "--output=short-iso"],
        timeout=15,
    )
    if rc != 0:
        return {"error": stderr.strip(), "lines": []}

    log_lines = stdout.strip().split("\n") if stdout.strip() else []
    return {"service": service, "lines": log_lines, "count": len(log_lines)}
