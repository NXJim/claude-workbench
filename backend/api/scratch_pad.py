"""Scratch pad API — persistent command library with ingestion from .cwb-scratch.md."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session
from services.scratch_pad_manager import ingest_and_get, delete_entry, update_entry, clear_all

router = APIRouter(prefix="/scratch", tags=["scratch"])


class ScratchEntryResponse(BaseModel):
    id: str
    desc: Optional[str] = None
    machine: Optional[str] = None
    lang: str = "bash"
    code: str
    pinned: bool = False
    created_at: str


class ScratchPadResponse(BaseModel):
    entries: list[ScratchEntryResponse]
    count: int


class UpdateEntryRequest(BaseModel):
    pinned: Optional[bool] = None


async def _get_project_path(session_id: str, db: AsyncSession) -> str:
    """Look up the project path for a session, raising 404 if not found."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.project_path:
        raise HTTPException(status_code=404, detail="Session has no project path")
    return session.project_path


@router.get("/{session_id}", response_model=ScratchPadResponse)
async def get_scratch_pad(session_id: str, db: AsyncSession = Depends(get_db)):
    """Ingest any new entries from .cwb-scratch.md and return full history."""
    project_path = await _get_project_path(session_id, db)
    entries = ingest_and_get(project_path)
    return ScratchPadResponse(entries=entries, count=len(entries))


@router.delete("/{session_id}/{entry_id}")
async def delete_scratch_entry(session_id: str, entry_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a single scratch pad entry."""
    project_path = await _get_project_path(session_id, db)
    if not delete_entry(project_path, entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"status": "deleted"}


@router.delete("/{session_id}")
async def clear_scratch_pad(session_id: str, db: AsyncSession = Depends(get_db)):
    """Clear all scratch pad entries (pinned entries survive)."""
    project_path = await _get_project_path(session_id, db)
    removed = clear_all(project_path)
    return {"status": "cleared", "removed": removed}


@router.patch("/{session_id}/{entry_id}")
async def update_scratch_entry(
    session_id: str,
    entry_id: str,
    body: UpdateEntryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update a scratch pad entry (pin/unpin)."""
    project_path = await _get_project_path(session_id, db)
    entry = update_entry(project_path, entry_id, pinned=body.pinned)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry
