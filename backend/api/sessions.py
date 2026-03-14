"""Session CRUD endpoints."""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session
from schemas import SessionCreate, SessionUpdate, SessionResponse, SessionNotesUpdate
from services.tmux_manager import tmux_session_name, create_session, kill_session, session_exists
from services.ttyd_manager import ttyd_manager
from services.activity_monitor import activity_monitor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])

# Dead sessions older than this are automatically deleted
STALE_SESSION_TTL_DAYS = 7


@router.get("", response_model=list[SessionResponse])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    """List all sessions, reconciling with live tmux state and cleaning stale ones."""
    result = await db.execute(select(Session).order_by(Session.created_at.desc()))
    sessions = result.scalars().all()

    # Reconcile: mark dead sessions and clean stale ones
    stale_cutoff = datetime.utcnow() - timedelta(days=STALE_SESSION_TTL_DAYS)
    stale_ids = []
    for s in sessions:
        alive = session_exists(s.tmux_name)
        if s.is_alive and not alive:
            s.is_alive = 0
            s.status = "disconnected"
        # Auto-delete dead sessions older than TTL
        if not alive and s.last_activity_at and s.last_activity_at < stale_cutoff:
            stale_ids.append(s.id)

    # Remove stale sessions from DB
    if stale_ids:
        await db.execute(delete(Session).where(Session.id.in_(stale_ids)))
        logger.info("Cleaned %d stale sessions: %s", len(stale_ids), stale_ids)

    await db.commit()

    # Return non-stale sessions
    return [s for s in sessions if s.id not in stale_ids]


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

    # Create DB record
    display_name = data.display_name
    if not display_name and data.project_path:
        display_name = data.project_path.rstrip("/").split("/")[-1]

    session = Session(
        id=session_id,
        tmux_name=tmux_name,
        project_path=data.project_path,
        display_name=display_name or f"Session {session_id}",
        color=data.color or "#7aa2f7",
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
