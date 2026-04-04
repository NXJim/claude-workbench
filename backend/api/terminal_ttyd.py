"""
Terminal API endpoints for ttyd-based terminal rendering.

Replaces the old WebSocket-to-PTY bridge (terminal_ws.py) with ttyd process
management. Each session gets a ttyd process; the frontend embeds it via iframe.
"""

import logging

from fastapi import APIRouter, Query
from pydantic import BaseModel

from services.tmux_manager import tmux_session_name, session_exists, create_session, send_keys
from services.ttyd_manager import ttyd_manager
from services.activity_monitor import activity_monitor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/terminal", tags=["terminal"])


class SendKeysRequest(BaseModel):
    """Request body for sending keys to a tmux session."""
    session_id: str
    keys: str
    enter: bool = False


@router.get("/url")
async def get_terminal_url(
    session_id: str = Query(..., description="Session ID from database"),
):
    """
    Get the ttyd port for a session. Starts ttyd if not already running.
    The frontend constructs the full URL using its own hostname.
    """
    tmux_name = tmux_session_name(session_id)

    # Ensure tmux session exists
    if not session_exists(tmux_name):
        create_session(tmux_name)

    # Start ttyd if not running, and register for activity monitoring
    if not ttyd_manager.is_running(session_id):
        ttyd_manager.start(session_id, tmux_name)
        activity_monitor.track_session(session_id)

    port = ttyd_manager.get_port(session_id)
    if port is None:
        return {"error": "Failed to start terminal"}, 500

    return {"port": port, "session_id": session_id}


@router.post("/send-keys")
async def terminal_send_keys(body: SendKeysRequest):
    """
    Send keystrokes to a tmux session. Used by Quick Paste and other
    programmatic input (since the iframe is cross-origin and we can't
    access the terminal buffer directly).
    """
    tmux_name = tmux_session_name(body.session_id)

    if not session_exists(tmux_name):
        return {"error": "Session not found"}, 404

    success = send_keys(tmux_name, body.keys, enter=body.enter)
    return {"success": success}


@router.post("/stop")
async def stop_terminal(
    session_id: str = Query(..., description="Session ID to stop"),
):
    """Stop the ttyd process for a session."""
    stopped = ttyd_manager.stop(session_id)
    activity_monitor.untrack_session(session_id)
    return {"stopped": stopped, "session_id": session_id}
