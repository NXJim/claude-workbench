"""
Activity monitor — detects when Claude transitions from busy to idle,
and when tmux sessions die (e.g. user types "exit").

Uses tmux polling to check the current command running in each session's pane.
If the command is a shell (bash, zsh, etc.), the session is idle.
If it's anything else (claude, node, python, etc.), the session is busy.
If the tmux session no longer exists, fires the dead callback.
"""

import asyncio
import logging
import subprocess
from typing import Callable, Awaitable, Optional

from config import ACTIVITY_POLL_INTERVAL, IDLE_SHELLS
from services.tmux_manager import tmux_session_name, session_exists, is_pane_dead

logger = logging.getLogger(__name__)


class ActivityMonitor:
    """Polls tmux panes to detect busy→idle transitions and dead sessions."""

    def __init__(self):
        # session_id -> "busy" | "idle"
        self._state: dict[str, str] = {}
        # Tracked session IDs (set by whoever manages sessions)
        self._tracked_sessions: set[str] = set()
        # Callbacks
        self._on_idle: Optional[Callable[[str], Awaitable[None]]] = None
        self._on_dead: Optional[Callable[[str], Awaitable[None]]] = None
        self._on_pane_dead: Optional[Callable[[str], Awaitable[None]]] = None
        self._poll_task: Optional[asyncio.Task] = None

    def set_idle_callback(self, callback: Callable[[str], Awaitable[None]]):
        """Set callback invoked when a session transitions busy→idle."""
        self._on_idle = callback

    def set_dead_callback(self, callback: Callable[[str], Awaitable[None]]):
        """Set callback invoked when a tmux session dies."""
        self._on_dead = callback

    def set_pane_dead_callback(self, callback: Callable[[str], Awaitable[None]]):
        """Set callback invoked when a pane's process exits (remain-on-exit keeps session alive)."""
        self._on_pane_dead = callback

    def track_session(self, session_id: str):
        """Start tracking a session for activity changes."""
        self._tracked_sessions.add(session_id)

    def untrack_session(self, session_id: str):
        """Stop tracking a session."""
        self._tracked_sessions.discard(session_id)
        self._state.pop(session_id, None)

    def get_state(self, session_id: str) -> str:
        """Get current activity state for a session."""
        return self._state.get(session_id, "idle")

    def _get_pane_command(self, tmux_name: str) -> Optional[str]:
        """Query tmux for the current command running in a session's pane."""
        try:
            result = subprocess.run(
                ["tmux", "display-message", "-t", tmux_name, "-p", "#{pane_current_command}"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except (subprocess.TimeoutExpired, Exception) as e:
            logger.debug("Failed to get pane command for %s: %s", tmux_name, e)
        return None

    def _check_session_alive(self, tmux_name: str) -> bool:
        """Check if a tmux session still exists."""
        return session_exists(tmux_name)

    async def start(self):
        """Start the periodic polling loop."""
        self._poll_task = asyncio.create_task(self._poll_loop())

    async def stop(self):
        """Stop the polling loop."""
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass

    async def _poll_loop(self):
        """Poll all tracked sessions every ACTIVITY_POLL_INTERVAL seconds."""
        loop = asyncio.get_event_loop()

        while True:
            try:
                await asyncio.sleep(ACTIVITY_POLL_INTERVAL)

                for session_id in list(self._tracked_sessions):
                    tmux_name = tmux_session_name(session_id)

                    # Check if tmux session is still alive
                    alive = await loop.run_in_executor(
                        None, self._check_session_alive, tmux_name
                    )

                    if not alive:
                        logger.info("tmux session %s died, firing dead callback", tmux_name)
                        self.untrack_session(session_id)
                        if self._on_dead:
                            try:
                                await self._on_dead(session_id)
                            except Exception as e:
                                logger.error("Dead callback error for %s: %s", session_id, e)
                        continue

                    # Check if the pane's process exited (remain-on-exit keeps the session)
                    pane_dead = await loop.run_in_executor(
                        None, is_pane_dead, tmux_name
                    )
                    if pane_dead:
                        old_state = self._state.get(session_id)
                        if old_state != "pane_dead":
                            self._state[session_id] = "pane_dead"
                            logger.info("Pane dead in tmux session %s (process exited)", tmux_name)
                            if self._on_pane_dead:
                                try:
                                    await self._on_pane_dead(session_id)
                                except Exception as e:
                                    logger.error("Pane dead callback error for %s: %s", session_id, e)
                        continue

                    cmd = await loop.run_in_executor(
                        None, self._get_pane_command, tmux_name
                    )

                    if cmd is None:
                        continue

                    # Determine state from the running command
                    old_state = self._state.get(session_id, "idle")
                    new_state = "idle" if cmd in IDLE_SHELLS else "busy"
                    self._state[session_id] = new_state

                    # Fire callback on busy→idle transition
                    if old_state == "busy" and new_state == "idle" and self._on_idle:
                        try:
                            await self._on_idle(session_id)
                        except Exception as e:
                            logger.error("Idle callback error for %s: %s", session_id, e)

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("Activity poll error: %s", e)

    def remove_session(self, session_id: str):
        """Clean up tracking for a removed session."""
        self.untrack_session(session_id)


# Global singleton
activity_monitor = ActivityMonitor()
