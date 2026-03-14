"""Code snippets knowledge base API."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from database import get_db
from models import Snippet, generate_id
from schemas import SnippetCreate, SnippetUpdate, SnippetResponse

router = APIRouter(prefix="/snippets", tags=["snippets"])


@router.get("", response_model=list[SnippetResponse])
async def list_snippets(
    q: Optional[str] = Query(None, description="Search query"),
    tag: Optional[str] = Query(None, description="Filter by tag"),
    lang: Optional[str] = Query(None, description="Filter by language"),
    db: AsyncSession = Depends(get_db),
):
    """List/search/filter snippets."""
    query = select(Snippet).order_by(Snippet.updated_at.desc())

    if q:
        pattern = f"%{q}%"
        query = query.where(
            or_(
                Snippet.title.ilike(pattern),
                Snippet.description.ilike(pattern),
                Snippet.code.ilike(pattern),
            )
        )

    if tag:
        query = query.where(Snippet.tags.ilike(f"%{tag}%"))

    if lang:
        query = query.where(Snippet.language == lang)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=SnippetResponse)
async def create_snippet(data: SnippetCreate, db: AsyncSession = Depends(get_db)):
    """Create a new code snippet."""
    snippet = Snippet(
        id=generate_id(),
        title=data.title,
        description=data.description,
        language=data.language,
        code=data.code,
        tags=data.tags,
        source_project=data.source_project,
    )
    db.add(snippet)
    await db.commit()
    await db.refresh(snippet)
    return snippet


@router.get("/tags")
async def list_tags(db: AsyncSession = Depends(get_db)):
    """List all unique tags across snippets."""
    result = await db.execute(select(Snippet.tags))
    all_tags = set()
    for row in result.scalars():
        if row:
            for tag in row.split(","):
                tag = tag.strip()
                if tag:
                    all_tags.add(tag)
    return sorted(all_tags)


@router.get("/{snippet_id}", response_model=SnippetResponse)
async def get_snippet(snippet_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single snippet."""
    result = await db.execute(select(Snippet).where(Snippet.id == snippet_id))
    snippet = result.scalar_one_or_none()
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return snippet


@router.put("/{snippet_id}", response_model=SnippetResponse)
async def update_snippet(
    snippet_id: str,
    data: SnippetUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a snippet."""
    result = await db.execute(select(Snippet).where(Snippet.id == snippet_id))
    snippet = result.scalar_one_or_none()
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found")

    if data.title is not None:
        snippet.title = data.title
    if data.description is not None:
        snippet.description = data.description
    if data.language is not None:
        snippet.language = data.language
    if data.code is not None:
        snippet.code = data.code
    if data.tags is not None:
        snippet.tags = data.tags
    if data.source_project is not None:
        snippet.source_project = data.source_project

    await db.commit()
    await db.refresh(snippet)
    return snippet


@router.delete("/{snippet_id}")
async def delete_snippet(snippet_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a snippet."""
    result = await db.execute(select(Snippet).where(Snippet.id == snippet_id))
    snippet = result.scalar_one_or_none()
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found")
    await db.delete(snippet)
    await db.commit()
    return {"status": "deleted"}
