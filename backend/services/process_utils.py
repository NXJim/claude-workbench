"""Shared process detection utilities for dev mode health checks and system management.

Used by both backend/api/system.py (mode-aware status/restart/stop) and
backend/api/dev_health.py (diagnose/repair orphaned processes).
"""

import asyncio
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

from config import PROJECT_ROOT


async def run_cmd(cmd: list[str], timeout: int = 5) -> tuple[int, str, str]:
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
    return proc.returncode or 0, stdout.decode(), stderr.decode()


async def get_pids_on_port(port: int) -> list[dict]:
    """Find all PIDs listening on a given TCP port.

    Returns list of {pid, cmdline} dicts. Tries ss first (fast), falls back
    to lsof when ss can't resolve PIDs (common with Node.js/Vite processes
    where ss shows the port as LISTEN but the Process column is empty).
    """
    results = []
    seen_pids: set[int] = set()

    # Try ss first — fast and works for most processes
    rc, stdout, _ = await run_cmd(["ss", "-tlnp", f"sport = :{port}"])
    if rc == 0 and stdout.strip():
        port_is_listening = False
        for line in stdout.strip().split("\n")[1:]:  # skip header
            port_is_listening = True
            for match in re.finditer(r'pid=(\d+)', line):
                pid = int(match.group(1))
                if pid in seen_pids:
                    continue
                seen_pids.add(pid)
                cmdline = read_process_cmdline(pid)
                results.append({"pid": pid, "cmdline": cmdline})

        # If ss saw a listener but couldn't resolve the PID, fall back to lsof
        if port_is_listening and not results:
            results = await _lsof_pids_on_port(port)

    return results


async def _lsof_pids_on_port(port: int) -> list[dict]:
    """Fallback: use sudo lsof to find PIDs listening on a port.

    Both ss -p and lsof need elevated privileges to resolve socket-to-PID
    mappings for Node.js processes on Linux. The -sTCP:LISTEN filter ensures
    we only get the server process, not client connections.
    """
    rc, stdout, _ = await run_cmd(["sudo", "lsof", "-i", f":{port}", "-sTCP:LISTEN", "-t"])
    if rc != 0 or not stdout.strip():
        return []

    results = []
    seen_pids: set[int] = set()
    for line in stdout.strip().split("\n"):
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid in seen_pids:
            continue
        seen_pids.add(pid)
        cmdline = read_process_cmdline(pid)
        results.append({"pid": pid, "cmdline": cmdline})
    return results


async def find_processes_by_pattern(pattern: str) -> list[dict]:
    """Find processes matching a grep pattern via pgrep.

    Returns list of {pid, cmdline} dicts. Excludes the current process.
    """
    rc, stdout, _ = await run_cmd(["pgrep", "-f", pattern])
    if rc != 0 or not stdout.strip():
        return []

    my_pid = os.getpid()
    results = []
    for line in stdout.strip().split("\n"):
        pid = int(line.strip())
        if pid == my_pid:
            continue
        cmdline = read_process_cmdline(pid)
        results.append({"pid": pid, "cmdline": cmdline})
    return results


def read_process_cmdline(pid: int) -> str:
    """Read the command line for a process from /proc."""
    try:
        return Path(f"/proc/{pid}/cmdline").read_text().replace("\x00", " ").strip()
    except (FileNotFoundError, PermissionError):
        return ""


def _process_seconds_ago(pid: int) -> float:
    """Calculate how many seconds ago a process started.

    Parses /proc/[pid]/stat safely — the comm field (field 2) is enclosed
    in parentheses and can contain spaces, so we find the last ')' and
    split fields from there instead of naive split().

    Raises on any failure (caller should catch).
    """
    stat = Path(f"/proc/{pid}/stat").read_text()
    # Field 2 (comm) is in parens and may contain spaces. Find last ')' to skip it.
    close_paren = stat.rfind(')')
    # Fields after comm start at index 3 (state, ppid, pgrp, ...).
    # starttime is field 22 (1-indexed), which is index 19 in the post-comm fields.
    fields_after_comm = stat[close_paren + 2:].split()
    starttime_ticks = int(fields_after_comm[19])
    with open("/proc/uptime") as f:
        uptime_secs = float(f.read().split()[0])
    clock_ticks = os.sysconf("SC_CLK_TCK")
    return uptime_secs - (starttime_ticks / clock_ticks)


def process_start_time_human(pid: int) -> str:
    """Get human-readable relative start time (e.g. '5m ago') from /proc/[pid]/stat."""
    try:
        secs_ago = _process_seconds_ago(pid)
        if secs_ago < 60:
            return f"{int(secs_ago)}s ago"
        elif secs_ago < 3600:
            return f"{int(secs_ago / 60)}m ago"
        elif secs_ago < 86400:
            return f"{int(secs_ago / 3600)}h ago"
        else:
            return f"{int(secs_ago / 86400)}d ago"
    except Exception:
        return "unknown"


def process_start_time_iso(pid: int) -> str:
    """Get ISO 8601 timestamp for process start time.

    Calculates absolute start time from /proc/[pid]/stat starttime field,
    system uptime, and current wall clock. Returns format compatible with
    the systemd ActiveEnterTimestamp that the frontend already parses.
    """
    try:
        secs_ago = _process_seconds_ago(pid)
        started_at = datetime.now(timezone.utc) - timedelta(seconds=secs_ago)
        return started_at.isoformat()
    except Exception:
        return ""


def get_process_memory(pid: int) -> int:
    """Get RSS memory in bytes from /proc/[pid]/statm."""
    try:
        statm = Path(f"/proc/{pid}/statm").read_text().split()
        rss_pages = int(statm[1])
        return rss_pages * os.sysconf("SC_PAGE_SIZE")
    except Exception:
        return 0


def is_workbench_process(cmdline: str) -> bool:
    """Check if a command line looks like a workbench-related process."""
    workbench_indicators = [
        "claude-workbench",
        str(PROJECT_ROOT),
        "main:app",
        "main.py",
    ]
    return any(indicator in cmdline for indicator in workbench_indicators)


def short_name(cmdline: str) -> str:
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
