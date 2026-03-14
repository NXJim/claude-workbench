"""Project discovery and creation endpoints."""

from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session, Setting
from config import PROJECTS_ROOT
from schemas import ProjectInfo
from services.project_discovery import discover_projects
from services.project_creator import create_project
from api.settings import get_project_categories

router = APIRouter(prefix="/projects", tags=["projects"])


async def _get_projects_root(db: AsyncSession) -> Path:
    """Read projects_root from settings, falling back to config default."""
    result = await db.execute(select(Setting).where(Setting.key == "projects_root"))
    row = result.scalar_one_or_none()
    return Path(row.value) if row else PROJECTS_ROOT


class ProjectCreateRequest(BaseModel):
    name: str
    type: str  # web, apps, tools, data
    description: str = ""
    tech_stack: str = ""
    backend_port: Optional[int] = None
    frontend_port: Optional[int] = None


@router.get("", response_model=list[ProjectInfo])
async def list_projects(db: AsyncSession = Depends(get_db)):
    """List all discovered projects with session counts."""
    projects_root = await _get_projects_root(db)
    categories = await get_project_categories(db)
    category_names = [c["name"] for c in categories]
    projects = discover_projects(projects_root, project_types=category_names)

    # Count sessions per project path
    result = await db.execute(
        select(Session.project_path, func.count(Session.id))
        .where(Session.is_alive == 1)
        .group_by(Session.project_path)
    )
    session_counts = dict(result.all())

    for p in projects:
        p["session_count"] = session_counts.get(p["path"], 0)

    return projects


@router.post("")
async def create_new_project(req: ProjectCreateRequest, db: AsyncSession = Depends(get_db)):
    """Create a new project with full scaffolding."""
    try:
        projects_root = await _get_projects_root(db)
        categories = await get_project_categories(db)
        category_names = [c["name"] for c in categories]
        result = create_project(
            name=req.name,
            project_type=req.type,
            description=req.description,
            tech_stack=req.tech_stack,
            backend_port=req.backend_port,
            frontend_port=req.frontend_port,
            valid_types=category_names,
            projects_root=projects_root,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
