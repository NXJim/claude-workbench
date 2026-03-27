"""tmux session management using the invisible workbench config."""

import subprocess
import logging
from pathlib import Path

from config import TMUX_CONF_PATH, TMUX_SESSION_PREFIX

logger = logging.getLogger(__name__)


def tmux_session_name(session_id: str) -> str:
    """Generate consistent tmux session name."""
    return f"{TMUX_SESSION_PREFIX}-{session_id}"


def session_exists(tmux_name: str) -> bool:
    """Check if a tmux session exists."""
    result = subprocess.run(
        ["tmux", "has-session", "-t", tmux_name],
        capture_output=True,
    )
    return result.returncode == 0


def create_session(tmux_name: str, working_dir: str = None, cols: int = 120, rows: int = 30) -> bool:
    """Create a new tmux session with the invisible workbench config."""
    if session_exists(tmux_name):
        return True

    cmd = [
        "tmux", "-f", str(TMUX_CONF_PATH),
        "new-session", "-d",
        "-s", tmux_name,
        "-x", str(cols), "-y", str(rows),
    ]

    if working_dir and Path(working_dir).is_dir():
        cmd.extend(["-c", working_dir])

    # Strip CLAUDECODE env var so Claude Code doesn't think it's nested
    import os
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        logger.error("Failed to create tmux session %s: %s", tmux_name, result.stderr)
        return False

    # Keep pane alive when the process inside exits — allows respawning
    subprocess.run(
        ["tmux", "set-option", "-t", tmux_name, "remain-on-exit", "on"],
        capture_output=True,
    )

    logger.info("Created tmux session: %s", tmux_name)
    return True


def kill_session(tmux_name: str) -> bool:
    """Kill a tmux session."""
    if not session_exists(tmux_name):
        return False

    result = subprocess.run(
        ["tmux", "kill-session", "-t", tmux_name],
        capture_output=True,
    )
    killed = result.returncode == 0
    if killed:
        logger.info("Killed tmux session: %s", tmux_name)
    return killed


def list_sessions() -> list[str]:
    """List all workbench tmux sessions."""
    result = subprocess.run(
        ["tmux", "list-sessions", "-F", "#{session_name}"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return []

    return [
        name.strip()
        for name in result.stdout.strip().split("\n")
        if name.strip().startswith(f"{TMUX_SESSION_PREFIX}-")
    ]


def is_pane_dead(tmux_name: str) -> bool:
    """Check if the pane's process has exited (remain-on-exit keeps the pane open)."""
    if not session_exists(tmux_name):
        return False
    result = subprocess.run(
        ["tmux", "display-message", "-t", tmux_name, "-p", "#{pane_dead}"],
        capture_output=True, text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "1"


def respawn_pane(tmux_name: str, working_dir: str = None) -> bool:
    """Respawn a dead pane, starting a fresh shell in it."""
    if not session_exists(tmux_name):
        return False

    cmd = ["tmux", "respawn-pane", "-t", tmux_name, "-k"]
    if working_dir and Path(working_dir).is_dir():
        cmd.extend(["-c", working_dir])

    import os
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        logger.error("Failed to respawn pane %s: %s", tmux_name, result.stderr)
        return False

    logger.info("Respawned pane in tmux session: %s", tmux_name)
    return True


def ensure_remain_on_exit(tmux_name: str) -> bool:
    """Set remain-on-exit on an existing session (e.g. recovered orphans)."""
    if not session_exists(tmux_name):
        return False
    result = subprocess.run(
        ["tmux", "set-option", "-t", tmux_name, "remain-on-exit", "on"],
        capture_output=True,
    )
    return result.returncode == 0


def resize_pane(tmux_name: str, cols: int, rows: int) -> bool:
    """Resize the tmux pane to the given dimensions."""
    if not session_exists(tmux_name):
        return False

    result = subprocess.run(
        ["tmux", "resize-window", "-t", tmux_name, "-x", str(cols), "-y", str(rows)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        logger.debug("Failed to resize tmux pane %s: %s", tmux_name, result.stderr)
        return False
    return True


def capture_scrollback(tmux_name: str, lines: int = 10000, end_line: int | None = None) -> str:
    """Capture scrollback from a tmux session.

    Args:
        tmux_name: tmux session name
        lines: how many lines back from cursor to start capture
        end_line: if set, end capture at this line (e.g. -1 = one line above visible screen).
                  If None, captures through the current cursor position.
    """
    if not session_exists(tmux_name):
        return ""

    cmd = ["tmux", "capture-pane", "-t", tmux_name, "-p", "-S", f"-{lines}"]
    if end_line is not None:
        cmd.extend(["-E", str(end_line)])

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return ""

    return result.stdout


def send_keys(tmux_name: str, keys: str) -> bool:
    """Send keys to a tmux session."""
    if not session_exists(tmux_name):
        return False

    result = subprocess.run(
        ["tmux", "send-keys", "-t", tmux_name, keys],
        capture_output=True,
    )
    return result.returncode == 0
