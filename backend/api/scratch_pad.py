"""Scratch pad API — reads .cwb-scratch.md from a session's project directory."""

import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session

router = APIRouter(prefix="/scratch", tags=["scratch"])

SCRATCH_FILENAME = ".cwb-scratch.md"


@router.get("/{session_id}")
async def get_scratch_pad(session_id: str, db: AsyncSession = Depends(get_db)):
    """Read the scratch pad file for a session's project directory."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.project_path:
        return {"content": "", "modified_at": None}

    scratch_path = Path(session.project_path) / SCRATCH_FILENAME
    if not scratch_path.is_file():
        return {"content": "", "modified_at": None}

    try:
        content = scratch_path.read_text(encoding="utf-8")
        mtime = os.path.getmtime(scratch_path)
        modified_at = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        return {"content": content, "modified_at": modified_at}
    except OSError:
        return {"content": "", "modified_at": None}
