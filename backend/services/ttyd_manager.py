"""
ttyd process lifecycle manager.

Spawns one ttyd instance per terminal session, each on a unique port.
ttyd handles xterm.js rendering and WebSocket communication internally —
we just manage process start/stop and port allocation.
"""

import asyncio
import json
import logging
import os
import subprocess
from dataclasses import dataclass
from typing import Optional

from config import TTYD_PORT_BASE, TTYD_PORT_MAX, TTYD_BINARY, TMUX_CONF_PATH

logger = logging.getLogger(__name__)

# Tokyo Night dark theme — matches the workbench dark mode
TTYD_THEME = {
    "background": "#0C0C0C",
    "foreground": "#c0caf5",
    "cursor": "#c0caf5",
    "selectionBackground": "#33467c",
    "black": "#15161e",
    "red": "#f7768e",
    "green": "#9ece6a",
    "yellow": "#e0af68",
    "blue": "#7aa2f7",
    "magenta": "#bb9af7",
    "cyan": "#7dcfff",
    "white": "#a9b1d6",
    "brightBlack": "#414868",
    "brightRed": "#f7768e",
    "brightGreen": "#9ece6a",
    "brightYellow": "#e0af68",
    "brightBlue": "#7aa2f7",
    "brightMagenta": "#bb9af7",
    "brightCyan": "#7dcfff",
    "brightWhite": "#c0caf5",
}


@dataclass
class TtydInstance:
    """Tracks a running ttyd process."""
    port: int
    pid: int
    process: subprocess.Popen
    tmux_name: str


class TtydManager:
    """Manages ttyd process lifecycle — one process per terminal session."""

    def __init__(self):
        self._instances: dict[str, TtydInstance] = {}
        self._used_ports: set[int] = set()

    def kill_orphans(self):
        """Kill any ttyd processes left over from a previous backend instance.
        Called on startup to reclaim ports blocked by orphaned processes."""
        import signal
        try:
            result = subprocess.run(
                ["pgrep", "-f", f"ttyd.*-p.*9[01]"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode != 0:
                return  # No matching processes

            for line in result.stdout.strip().split('\n'):
                pid = int(line.strip())
                # Don't kill our own children (shouldn't exist yet on startup)
                if pid in {inst.pid for inst in self._instances.values()}:
                    continue
                try:
                    os.kill(pid, signal.SIGTERM)
                    logger.info("Killed orphaned ttyd process PID %d", pid)
                except ProcessLookupError:
                    pass
                except Exception as e:
                    logger.warning("Failed to kill orphaned ttyd PID %d: %s", pid, e)

            # Wait briefly for processes to die and release ports
            import time
            time.sleep(0.5)
        except Exception as e:
            logger.warning("Orphan ttyd cleanup failed: %s", e)

    @staticmethod
    def _is_port_in_use(port: int) -> bool:
        """Check if a port is currently bound by any process."""
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', port)) == 0

    def _allocate_port(self) -> int:
        """Find the lowest available port in the configured range.
        Checks both our tracking set AND actual port availability to avoid
        collisions with orphaned ttyd processes."""
        for port in range(TTYD_PORT_BASE, TTYD_PORT_MAX + 1):
            if port not in self._used_ports and not self._is_port_in_use(port):
                self._used_ports.add(port)
                return port
        raise RuntimeError(f"No available ports in range {TTYD_PORT_BASE}-{TTYD_PORT_MAX}")

    def _release_port(self, port: int):
        """Return a port to the available pool."""
        self._used_ports.discard(port)

    def start(self, session_id: str, tmux_name: str) -> int:
        """
        Start a ttyd process for a session. Returns the port number.
        If already running, returns the existing port.
        """
        # Already running — return existing port
        if session_id in self._instances:
            inst = self._instances[session_id]
            if inst.process.poll() is None:
                return inst.port
            # Process died — clean up and restart
            self._release_port(inst.port)
            del self._instances[session_id]

        port = self._allocate_port()

        # Build ttyd command
        # ttyd spawns xterm.js in browser, connects to the given command's PTY
        # Theme JSON must not contain spaces — ttyd's -t flag parsing splits on spaces.
        # Use compact JSON (no spaces after separators).
        theme_json = json.dumps(TTYD_THEME, separators=(",", ":"))
        font_family = 'monospace'
        cmd = [
            TTYD_BINARY,
            "-W",  # Writable — required for ttyd ≥1.7 (readonly by default)
            "-p", str(port),
            "-i", "0.0.0.0",
            # xterm.js client options (each -t value must be a single arg with no spaces)
            "-t", f"theme={theme_json}",
            "-t", "fontSize=14",
            "-t", f"fontFamily={font_family}",
            "-t", "cursorBlink=true",
            "-t", "scrollback=50000",  # Match tmux history-limit — prevents buffer mismatch garbling
            # tmux attach command
            "tmux", "-f", str(TMUX_CONF_PATH),
            "attach-session", "-t", tmux_name,
        ]

        # Strip CLAUDECODE so Claude Code doesn't refuse to launch inside terminals
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,  # Don't pipe stderr — nobody reads it, and a full pipe buffer blocks ttyd
                env=env,
                start_new_session=True,  # Own process group — survives parent restarts/signals
            )

            self._instances[session_id] = TtydInstance(
                port=port,
                pid=process.pid,
                process=process,
                tmux_name=tmux_name,
            )

            logger.info(
                "Started ttyd for session %s on port %d (PID %d, tmux=%s)",
                session_id, port, process.pid, tmux_name,
            )
            return port

        except Exception as e:
            self._release_port(port)
            logger.error("Failed to start ttyd for session %s: %s", session_id, e)
            raise

    def stop(self, session_id: str) -> bool:
        """Stop a ttyd process for a session."""
        inst = self._instances.pop(session_id, None)
        if not inst:
            return False

        try:
            inst.process.terminate()
            try:
                inst.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                inst.process.kill()
                inst.process.wait(timeout=2)
        except Exception as e:
            logger.warning("Error stopping ttyd for session %s: %s", session_id, e)

        self._release_port(inst.port)
        logger.info("Stopped ttyd for session %s (port %d)", session_id, inst.port)
        return True

    def stop_all(self):
        """Stop all ttyd processes. Called on backend shutdown."""
        session_ids = list(self._instances.keys())
        for sid in session_ids:
            self.stop(sid)
        logger.info("All ttyd processes stopped")

    def get_port(self, session_id: str) -> Optional[int]:
        """Get the port for a running ttyd instance, or None if not running."""
        inst = self._instances.get(session_id)
        if not inst:
            return None
        # Check if process is still alive
        if inst.process.poll() is not None:
            # Process died — clean up
            self._release_port(inst.port)
            del self._instances[session_id]
            return None
        return inst.port

    def get_url(self, session_id: str, host: str | None = None) -> Optional[str]:
        if host is None:
            from config import PUBLIC_HOST
            host = PUBLIC_HOST
        """Get the full URL for a running ttyd instance."""
        port = self.get_port(session_id)
        if port is None:
            return None
        return f"http://{host}:{port}/"

    def is_running(self, session_id: str) -> bool:
        """Check if a ttyd instance is running for a session."""
        return self.get_port(session_id) is not None


# Global singleton
ttyd_manager = TtydManager()
