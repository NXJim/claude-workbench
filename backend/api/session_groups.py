"""Session groups API — batch launch/close named session sets."""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import SessionGroup, Session, generate_id
from schemas import SessionGroupCreate, SessionGroupUpdate, SessionGroupResponse
from services.tmux_manager import create_session as create_tmux, tmux_session_name

router = APIRouter(prefix="/session-groups", tags=["session-groups"])


@router.get("", response_model=list[SessionGroupResponse])
async def list_groups(db: AsyncSession = Depends(get_db)):
    """List all session groups."""
    result = await db.execute(select(SessionGroup).order_by(SessionGroup.name))
    return result.scalars().all()


@router.post("", response_model=SessionGroupResponse)
async def create_group(data: SessionGroupCreate, db: AsyncSession = Depends(get_db)):
    """Create a new session group."""
    group = SessionGroup(
        id=generate_id(),
        name=data.name,
        project_path=data.project_path,
        session_configs=json.dumps(data.session_configs),
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.put("/{group_id}", response_model=SessionGroupResponse)
async def update_group(
    group_id: str,
    data: SessionGroupUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a session group."""
    result = await db.execute(select(SessionGroup).where(SessionGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if data.name is not None:
        group.name = data.name
    if data.project_path is not None:
        group.project_path = data.project_path
    if data.session_configs is not None:
        group.session_configs = json.dumps(data.session_configs)

    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}")
async def delete_group(group_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a session group."""
    result = await db.execute(select(SessionGroup).where(SessionGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.delete(group)
    await db.commit()
    return {"status": "deleted"}


@router.post("/{group_id}/launch")
async def launch_group(group_id: str, db: AsyncSession = Depends(get_db)):
    """Launch all sessions configured in this group."""
    result = await db.execute(select(SessionGroup).where(SessionGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    configs = json.loads(group.session_configs) if isinstance(group.session_configs, str) else group.session_configs
    created_sessions = []

    for config in configs:
        session_id = generate_id()
        tmux_name = tmux_session_name(session_id)
        project_path = config.get("project_path") or group.project_path
        display_name = config.get("display_name", f"Group: {group.name}")
        color = config.get("color", "#7aa2f7")

        create_tmux(tmux_name, working_dir=project_path)

        session = Session(
            id=session_id,
            tmux_name=tmux_name,
            project_path=project_path,
            display_name=display_name,
            color=color,
        )
        db.add(session)
        created_sessions.append(session_id)

    await db.commit()
    return {"status": "launched", "session_ids": created_sessions}


@router.post("/{group_id}/close")
async def close_group(group_id: str, db: AsyncSession = Depends(get_db)):
    """Close all sessions that belong to this group's project path."""
    result = await db.execute(select(SessionGroup).where(SessionGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # Find sessions matching the group's project path that are alive
    configs = json.loads(group.session_configs) if isinstance(group.session_configs, str) else group.session_configs
    project_paths = {c.get("project_path") or group.project_path for c in configs}

    closed = []
    for pp in project_paths:
        if not pp:
            continue
        sessions_result = await db.execute(
            select(Session).where(Session.project_path == pp, Session.is_alive == 1)
        )
        for session in sessions_result.scalars():
            from services.tmux_manager import kill_session
            from services.ttyd_manager import ttyd_manager
            try:
                ttyd_manager.stop(session.id)
                kill_session(session.tmux_name)
            except Exception:
                pass
            session.is_alive = 0
            closed.append(session.id)

    await db.commit()
    return {"status": "closed", "session_ids": closed}
