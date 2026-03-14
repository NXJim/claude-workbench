"""Scrollback search endpoint — captures tmux pane content and searches it."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session, ScrollbackEntry
from services.tmux_manager import capture_scrollback

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
async def search_scrollback(
    q: str = Query(..., min_length=1, description="Search query"),
    db: AsyncSession = Depends(get_db),
):
    """
    Search scrollback across all live sessions.
    Captures current tmux pane content, stores it, then searches.
    """
    if not q.strip():
        return []

    query_lower = q.strip().lower()

    # Get all live sessions
    result = await db.execute(select(Session).where(Session.is_alive == 1))
    sessions = result.scalars().all()

    results = []

    for session in sessions:
        # Capture current scrollback from tmux
        content = capture_scrollback(session.tmux_name)
        if not content:
            continue

        # Store for future reference
        entry = ScrollbackEntry(
            session_id=session.id,
            content=content,
            captured_at=datetime.utcnow(),
        )
        db.add(entry)

        # Search line by line
        matching_lines = []
        for line in content.split("\n"):
            if query_lower in line.lower():
                matching_lines.append(line.rstrip())

        if matching_lines:
            results.append({
                "session_id": session.id,
                "session_name": session.display_name,
                "session_color": session.color,
                "lines": matching_lines[:50],  # Cap at 50 matches per session
                "captured_at": datetime.utcnow().isoformat(),
            })

    await db.commit()
    return results
