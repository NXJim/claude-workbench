"""Notes API — global and per-project markdown notes with real-time SSE sync."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from schemas import NoteCreate, NoteUpdate, NoteMetadataUpdate
from services.notes_manager import (
    list_notes,
    create_note,
    get_note,
    update_note_content,
    update_note_metadata,
    delete_note,
)
from api.notifications import broadcast_notification

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("")
async def list_all_notes(
    scope: str = Query("global", description="'global' or 'project'"),
    path: Optional[str] = Query(None, description="Project path for project-scoped notes"),
):
    """List notes (global or project-scoped)."""
    return list_notes(scope=scope, project_path=path)


@router.post("")
async def create_new_note(data: NoteCreate):
    """Create a new note."""
    result = create_note(
        title=data.title,
        content=data.content,
        scope=data.scope,
        project_path=data.project_path,
    )
    await broadcast_notification("notes", {
        "type": "note_created",
        "note_id": result["id"],
        "scope": data.scope,
        "project_path": data.project_path,
    })
    return result


@router.get("/{note_id}")
async def get_note_content(
    note_id: str,
    scope: str = Query("global"),
    path: Optional[str] = Query(None),
):
    """Get a note's content and metadata."""
    result = get_note(note_id, scope=scope, project_path=path)
    if not result:
        raise HTTPException(status_code=404, detail="Note not found")
    return result


@router.put("/{note_id}")
async def update_content(
    note_id: str,
    data: NoteUpdate,
    scope: str = Query("global"),
    path: Optional[str] = Query(None),
):
    """Update a note's content (auto-save target)."""
    result = update_note_content(note_id, data.content, scope=scope, project_path=path)
    if not result:
        raise HTTPException(status_code=404, detail="Note not found")
    await broadcast_notification("notes", {
        "type": "note_updated",
        "note_id": note_id,
        "scope": scope,
        "project_path": path,
    })
    return result


@router.patch("/{note_id}")
async def update_metadata(
    note_id: str,
    data: NoteMetadataUpdate,
    scope: str = Query("global"),
    path: Optional[str] = Query(None),
):
    """Update a note's metadata (title, pinned)."""
    result = update_note_metadata(
        note_id,
        title=data.title,
        pinned=data.pinned,
        scope=scope,
        project_path=path,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Note not found")
    await broadcast_notification("notes", {
        "type": "note_metadata",
        "note_id": note_id,
        "scope": scope,
        "project_path": path,
    })
    return result


@router.delete("/{note_id}")
async def delete_note_endpoint(
    note_id: str,
    scope: str = Query("global"),
    path: Optional[str] = Query(None),
):
    """Delete a note and its file."""
    if not delete_note(note_id, scope=scope, project_path=path):
        raise HTTPException(status_code=404, detail="Note not found")
    await broadcast_notification("notes", {
        "type": "note_deleted",
        "note_id": note_id,
        "scope": scope,
        "project_path": path,
    })
    return {"status": "deleted"}
