"""Quick-paste phrases API — server-side persistence in SQLite."""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import QuickPastePhrase

router = APIRouter(prefix="/quick-paste", tags=["quick-paste"])
logger = logging.getLogger(__name__)

DEFAULT_PHRASES = [
    {"id": "1", "label": "Claude (skip perms)", "command": "claude --dangerously-skip-permissions", "sort_order": 0},
    {"id": "2", "label": "Claude", "command": "claude", "sort_order": 1},
    {"id": "3", "label": "Claude resume", "command": "claude --resume", "sort_order": 2},
    {"id": "4", "label": "Claude continue", "command": "claude --continue", "sort_order": 3},
]


class PhraseItem(BaseModel):
    id: str
    label: str
    command: str


class PhrasesUpdate(BaseModel):
    phrases: list[PhraseItem]


@router.get("")
async def get_phrases(db: AsyncSession = Depends(get_db)):
    """Get all quick-paste phrases, ordered by sort_order."""
    result = await db.execute(
        select(QuickPastePhrase).order_by(QuickPastePhrase.sort_order)
    )
    rows = result.scalars().all()

    # Seed defaults on first access
    if not rows:
        for item in DEFAULT_PHRASES:
            db.add(QuickPastePhrase(**item))
        await db.commit()
        result = await db.execute(
            select(QuickPastePhrase).order_by(QuickPastePhrase.sort_order)
        )
        rows = result.scalars().all()

    return [{"id": r.id, "label": r.label, "command": r.command} for r in rows]


@router.put("")
async def set_phrases(data: PhrasesUpdate, db: AsyncSession = Depends(get_db)):
    """Replace all phrases (handles add, remove, reorder, edit in one call)."""
    # Delete all existing
    await db.execute(delete(QuickPastePhrase))

    # Insert new set with sort_order from array position
    for i, phrase in enumerate(data.phrases):
        db.add(QuickPastePhrase(
            id=phrase.id,
            label=phrase.label,
            command=phrase.command,
            sort_order=i,
        ))
    await db.commit()

    return [{"id": p.id, "label": p.label, "command": p.command} for p in data.phrases]
