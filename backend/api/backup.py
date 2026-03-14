"""Backup management endpoints."""

from fastapi import APIRouter, HTTPException

from services.backup_manager import create_backup, list_backups, delete_backup

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("")
async def get_backups():
    """List all existing backups."""
    return list_backups()


@router.post("/{project_name}")
async def create_project_backup(project_name: str):
    """Create a backup of a project."""
    from services.project_discovery import discover_projects

    projects = discover_projects()
    project = next((p for p in projects if p["name"] == project_name), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        result = create_backup(project["path"], project["name"], project["type"])
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{filename}")
async def remove_backup(filename: str):
    """Delete a backup file."""
    try:
        deleted = delete_backup(filename)
        if not deleted:
            raise HTTPException(status_code=404, detail="Backup not found")
        return {"status": "deleted", "filename": filename}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
