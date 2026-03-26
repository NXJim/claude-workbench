"""Session CRUD endpoints."""

import logging
from datetime import datetime, timedelta, timezone

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session, ActiveLayout
from schemas import SessionCreate, SessionUpdate, SessionResponse, SessionNotesUpdate
from services.tmux_manager import (
    tmux_session_name, create_session, kill_session, session_exists,
    respawn_pane, is_pane_dead, send_keys,
)
from services.ttyd_manager import ttyd_manager
from services.activity_monitor import activity_monitor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])

# Dead sessions older than this are automatically deleted
STALE_SESSION_TTL_DAYS = 7


@router.get("", response_model=list[SessionResponse])
async def list_sessions(
    workspace_id: Optional[int] = Query(None, description="Filter sessions by workspace"),
    db: AsyncSession = Depends(get_db),
):
    """List sessions, optionally filtered by workspace. Reconciles with live tmux state."""
    query = select(Session).order_by(Session.created_at.desc())
    if workspace_id is not None:
        query = query.where(Session.workspace_id == workspace_id)
    result = await db.execute(query)
    sessions = result.scalars().all()

    # Reconcile: mark dead sessions and clean stale ones
    stale_cutoff = datetime.utcnow() - timedelta(days=STALE_SESSION_TTL_DAYS)
    stale_ids = []
    modified = False
    for s in sessions:
        alive = session_exists(s.tmux_name)
        if s.is_alive and not alive:
            s.is_alive = 0
            s.status = "disconnected"
            modified = True
        # Auto-delete dead sessions older than TTL
        if not alive and s.last_activity_at and s.last_activity_at < stale_cutoff:
            stale_ids.append(s.id)

    # Remove stale sessions from DB
    if stale_ids:
        await db.execute(delete(Session).where(Session.id.in_(stale_ids)))
        logger.info("Cleaned %d stale sessions: %s", len(stale_ids), stale_ids)
        modified = True

    if modified:
        await db.commit()

    # Re-query to avoid MissingGreenlet on server-side onupdate columns (last_activity_at)
    query = select(Session).order_by(Session.created_at.desc())
    if workspace_id is not None:
        query = query.where(Session.workspace_id == workspace_id)
    if stale_ids:
        query = query.where(Session.id.not_in(stale_ids))
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=SessionResponse)
async def create_new_session(data: SessionCreate, db: AsyncSession = Depends(get_db)):
    """Create a new session with a tmux backend."""
    from models import generate_id

    session_id = generate_id()
    tmux_name = tmux_session_name(session_id)

    # Create tmux session
    working_dir = data.project_path or str(__import__("pathlib").Path.home())
    if not create_session(tmux_name, working_dir):
        raise HTTPException(status_code=500, detail="Failed to create tmux session")

    # Prefill the Claude Code launch command so the user just presses Enter
    send_keys(tmux_name, "claude --dangerously-skip-permissions")

    # Create DB record
    display_name = data.display_name
    if not display_name and data.project_path:
        display_name = data.project_path.rstrip("/").split("/")[-1]

    # Determine workspace_id — explicit, or from active workspace
    ws_id = data.workspace_id
    if ws_id is None:
        active_result = await db.execute(select(ActiveLayout).where(ActiveLayout.id == 1))
        active_layout = active_result.scalar_one_or_none()
        if active_layout and active_layout.active_workspace_id:
            ws_id = active_layout.active_workspace_id

    session = Session(
        id=session_id,
        tmux_name=tmux_name,
        project_path=data.project_path,
        display_name=display_name or f"Session {session_id}",
        color=data.color or "#7aa2f7",
        workspace_id=ws_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    logger.info("Created session %s (tmux: %s, project: %s)", session_id, tmux_name, data.project_path)
    return session


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(session_id: str, data: SessionUpdate, db: AsyncSession = Depends(get_db)):
    """Update session name, color, or notes."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if data.display_name is not None:
        session.display_name = data.display_name
    if data.color is not None:
        session.color = data.color
    if data.notes is not None:
        session.notes = data.notes
    if data.workspace_id is not None:
        session.workspace_id = data.workspace_id

    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}")
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Kill tmux session and delete DB record."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Stop ttyd process first (prevents port leaks)
    ttyd_manager.stop(session_id)

    # Untrack from activity monitor
    activity_monitor.untrack_session(session_id)

    # Kill tmux
    kill_session(session.tmux_name)

    # Delete from DB
    await db.delete(session)
    await db.commit()

    logger.info("Deleted session %s (tmux: %s)", session_id, session.tmux_name)
    return {"status": "deleted", "id": session_id}


@router.put("/{session_id}/notes", response_model=SessionResponse)
async def update_session_notes(session_id: str, data: SessionNotesUpdate, db: AsyncSession = Depends(get_db)):
    """Save session notes."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.notes = data.notes
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/orphaned", response_model=list[SessionResponse])
async def list_orphaned_sessions(db: AsyncSession = Depends(get_db)):
    """List sessions with no workspace (orphaned/recovered tmux sessions)."""
    result = await db.execute(
        select(Session)
        .where(Session.workspace_id.is_(None), Session.is_alive == 1)
        .order_by(Session.created_at.desc())
    )
    sessions = result.scalars().all()

    # Reconcile with live tmux state
    for s in sessions:
        alive = session_exists(s.tmux_name)
        if not alive:
            s.is_alive = 0
            s.status = "disconnected"
        elif is_pane_dead(s.tmux_name):
            s.status = "pane_dead"

    await db.commit()

    # Re-query to avoid MissingGreenlet on server-side onupdate columns
    result = await db.execute(
        select(Session)
        .where(Session.workspace_id.is_(None), Session.is_alive == 1)
        .order_by(Session.created_at.desc())
    )
    return result.scalars().all()


@router.post("/{session_id}/respawn", response_model=SessionResponse)
async def respawn_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Respawn a dead pane in an existing tmux session."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session_exists(session.tmux_name):
        raise HTTPException(status_code=410, detail="tmux session no longer exists")

    if not respawn_pane(session.tmux_name, session.project_path):
        raise HTTPException(status_code=500, detail="Failed to respawn pane")

    session.status = "idle"
    session.is_alive = 1
    await db.commit()
    await db.refresh(session)

    # Re-track in activity monitor
    activity_monitor.track_session(session_id)

    logger.info("Respawned session %s (tmux: %s)", session_id, session.tmux_name)
    return session
