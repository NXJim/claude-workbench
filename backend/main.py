"""Claude Workbench — FastAPI backend."""

import os
# Strip CLAUDECODE immediately so no subprocess (tmux, pty fork) ever inherits it.
# Without this, Claude Code refuses to launch inside workbench terminals thinking
# it's nested inside another Claude Code session.
os.environ.pop("CLAUDECODE", None)

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import HOST, PORT, PUBLIC_HOST, FRONTEND_PORT, PROJECT_ROOT
from database import init_db
from api.sessions import router as sessions_router
from api.projects import router as projects_router
from api.layouts import router as layouts_router
from api.search import router as search_router
from api.terminal_ttyd import router as terminal_router
from api.notifications import router as notifications_router, broadcast_notification
from api.settings import router as settings_router
from api.notes import router as notes_router
from api.claude_md import router as claude_md_router
from api.snippets import router as snippets_router
from api.session_groups import router as session_groups_router
from api.clipboard import router as clipboard_router
from api.config_public import router as config_public_router
from api.ttyd_proxy import router as ttyd_proxy_router
from api.system import router as system_router
from api.backup import router as backup_router
from api.health import router as health_router
from services.activity_monitor import activity_monitor
from services.ttyd_manager import ttyd_manager
from services.tmux_manager import (
    list_sessions as list_tmux_sessions,
    kill_session as kill_tmux_session,
    tmux_session_name,
    ensure_remain_on_exit,
    is_pane_dead,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Claude Workbench", version="2026.03.24.001")

# CORS — allow frontend origins dynamically based on config
_origins = list({
    f"http://{PUBLIC_HOST}:{FRONTEND_PORT}",
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
    # Also allow same-origin requests when frontend is served by backend
    f"http://{PUBLIC_HOST}:{PORT}",
    f"http://localhost:{PORT}",
    f"http://127.0.0.1:{PORT}",
})
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers under /api
app.include_router(sessions_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(layouts_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(terminal_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(claude_md_router, prefix="/api")
app.include_router(snippets_router, prefix="/api")
app.include_router(session_groups_router, prefix="/api")
app.include_router(clipboard_router, prefix="/api")
app.include_router(config_public_router, prefix="/api")
app.include_router(system_router, prefix="/api")
app.include_router(backup_router, prefix="/api")
app.include_router(health_router, prefix="/api")

# ttyd proxy — HTTP + WebSocket proxy for production mode (no Vite)
app.include_router(ttyd_proxy_router)


async def _adopt_orphaned_tmux_sessions():
    """Adopt cwb-* tmux sessions that have no matching DB record.

    Instead of killing orphans, create DB records with workspace_id=NULL
    so they appear in the "Orphaned" tab and can be moved to a workspace.
    Also sets remain-on-exit on all existing sessions for crash resilience.
    """
    from database import async_session
    from sqlalchemy import select
    from models import Session
    from datetime import datetime, timezone

    live_tmux = list_tmux_sessions()
    if not live_tmux:
        return

    # Get all session IDs from DB
    async with async_session() as db:
        result = await db.execute(select(Session.id))
        db_ids = {row[0] for row in result.fetchall()}

    # Ensure remain-on-exit is set on ALL existing tmux sessions
    for tmux_name in live_tmux:
        ensure_remain_on_exit(tmux_name)

    # Find orphaned sessions (tmux exists but no DB record)
    orphaned = []
    for tmux_name in live_tmux:
        parts = tmux_name.split("-", 1)
        if len(parts) < 2:
            continue
        session_id = parts[1]
        if session_id not in db_ids:
            orphaned.append((session_id, tmux_name))

    if not orphaned:
        return

    # Create DB records for orphaned sessions (workspace_id=NULL → shows in Orphaned tab)
    async with async_session() as db:
        for session_id, tmux_name in orphaned:
            pane_dead = is_pane_dead(tmux_name)
            session = Session(
                id=session_id,
                tmux_name=tmux_name,
                display_name=f"Recovered {session_id[:8]}",
                status="pane_dead" if pane_dead else "idle",
                is_alive=1,
                workspace_id=None,  # NULL = orphaned, shows in Orphaned tab
            )
            db.add(session)
            logger.info("Adopted orphaned tmux session: %s", tmux_name)
        await db.commit()

    logger.info("Adopted %d orphaned tmux sessions", len(orphaned))


@app.on_event("startup")
async def startup():
    """Initialize database and start activity monitor."""
    # Kill any orphaned ttyd processes from previous backend instances
    # before initializing — reclaims blocked ports
    ttyd_manager.kill_orphans()

    await init_db()
    logger.info("Database initialized")

    # Set up activity monitor idle callback — sends SSE notification
    async def on_session_idle(session_id: str):
        """Called when a session transitions busy→idle (Claude is done)."""
        logger.info("Session %s transitioned to idle", session_id)
        await broadcast_notification(session_id, {
            "type": "activity",
            "state": "idle",
        })

    activity_monitor.set_idle_callback(on_session_idle)

    # When a tmux session dies (user typed "exit"), stop its ttyd and notify frontend
    # With remain-on-exit, this only fires if the tmux session itself is destroyed
    async def on_session_dead(session_id: str):
        """Called when a tmux session no longer exists."""
        logger.info("Session %s tmux died, stopping ttyd", session_id)
        ttyd_manager.stop(session_id)
        await broadcast_notification(session_id, {
            "type": "session_dead",
            "session_id": session_id,
        })

    # When the pane's process exits but remain-on-exit keeps the session alive
    async def on_pane_dead(session_id: str):
        """Called when the process inside a pane exits (session still exists)."""
        logger.info("Session %s pane process exited (recoverable)", session_id)
        await broadcast_notification(session_id, {
            "type": "pane_dead",
            "session_id": session_id,
        })

    activity_monitor.set_dead_callback(on_session_dead)
    activity_monitor.set_pane_dead_callback(on_pane_dead)
    await activity_monitor.start()
    logger.info("Activity monitor started")

    # Adopt orphaned tmux sessions (no matching DB record) instead of killing them
    await _adopt_orphaned_tmux_sessions()


@app.on_event("shutdown")
async def shutdown():
    """Clean up on shutdown."""
    await activity_monitor.stop()
    logger.info("Activity monitor stopped")
    ttyd_manager.stop_all()
    logger.info("ttyd processes stopped")


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "claude-workbench"}


# Serve built frontend in production mode (after all API routes)
# This must be last — it's a catch-all mount for the SPA
frontend_dist = PROJECT_ROOT.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True, log_level="info")
