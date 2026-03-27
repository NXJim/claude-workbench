"""API routes for managing plain .md files in project directories.

Project notes are stored as real .md files in {project}/notes/ —
separate from the manifest-based global notes system.
"""

import logging
from fastapi import APIRouter, HTTPException, Query

from schemas import ProjectFileCreate, ProjectFileRename, NoteMoveRequest
from services import project_file_manager as pfm

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/project-files", tags=["project-files"])


@router.post("/create")
async def create_project_file(data: ProjectFileCreate):
    """Create a new .md file in {project}/notes/."""
    try:
        result = pfm.create_note_file(data.project_path, data.title, data.content)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/rename")
async def rename_project_file(data: ProjectFileRename):
    """Rename a .md file on disk."""
    try:
        result = pfm.rename_file(data.file_path, data.new_name)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("")
async def delete_project_file(path: str = Query(..., description="Absolute path to .md file")):
    """Delete a .md file from a project."""
    try:
        deleted = pfm.delete_file(path)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"File not found: {path}")
        return {"status": "deleted", "path": path}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/move")
async def move_note(data: NoteMoveRequest):
    """Move a note between global notes and project files, or between projects."""
    try:
        if data.source_type == "global" and data.target_type == "project":
            # Global → project
            if not data.source_id:
                raise ValueError("source_id required for global source")
            if not data.target_project_path:
                raise ValueError("target_project_path required for project target")
            return pfm.move_global_to_project(data.source_id, data.target_project_path)

        elif data.source_type == "project" and data.target_type == "global":
            # Project → global
            if not data.source_path:
                raise ValueError("source_path required for project source")
            return pfm.move_project_to_global(data.source_path, data.title)

        elif data.source_type == "project" and data.target_type == "project":
            # Project → project
            if not data.source_path:
                raise ValueError("source_path required for project source")
            if not data.target_project_path:
                raise ValueError("target_project_path required for project target")
            return pfm.move_between_projects(
                data.source_path, data.target_project_path, data.title
            )

        else:
            raise ValueError(f"Invalid move: {data.source_type} → {data.target_type}")

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
