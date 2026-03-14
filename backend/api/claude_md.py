"""CLAUDE.md editor API — read/write CLAUDE.md and rules files."""

import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Setting
from config import PROJECTS_ROOT
from schemas import ClaudeMdFile, ClaudeMdContent, ClaudeMdWrite
from services.project_discovery import discover_projects
from api.settings import get_project_categories

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/claude-md", tags=["claude-md"])

# Allowed base paths for security
HOME = Path.home()
CLAUDE_DIR = HOME / ".claude"
PROJECTS_DIR = HOME / "projects"


def _is_safe_path(path: Path) -> bool:
    """Validate path is within allowed directories — prevents traversal."""
    resolved = path.resolve()
    return (
        resolved.is_relative_to(CLAUDE_DIR) or
        resolved.is_relative_to(PROJECTS_DIR)
    )


@router.get("/list", response_model=list[ClaudeMdFile])
async def list_claude_md_files(db: AsyncSession = Depends(get_db)):
    """Discover all CLAUDE.md files (global + per-project)."""
    files: list[dict] = []

    # 1. Global CLAUDE.md
    global_claude = CLAUDE_DIR / "CLAUDE.md"
    if global_claude.exists():
        files.append({
            "path": str(global_claude),
            "label": "Global CLAUDE.md",
            "category": "global",
            "project_name": None,
        })

    # 2. Global rules
    rules_dir = CLAUDE_DIR / "rules"
    if rules_dir.exists():
        for rule_file in sorted(rules_dir.glob("*.md")):
            files.append({
                "path": str(rule_file),
                "label": f"Rule: {rule_file.stem}",
                "category": "global-rules",
                "project_name": None,
            })

    # 3. Per-project CLAUDE.md files
    result = await db.execute(select(Setting).where(Setting.key == "projects_root"))
    row = result.scalar_one_or_none()
    projects_root = Path(row.value) if row else PROJECTS_ROOT

    categories = await get_project_categories(db)
    category_names = [c["name"] for c in categories]
    projects = discover_projects(projects_root, project_types=category_names)

    for p in projects:
        project_claude = Path(p["path"]) / "CLAUDE.md"
        if project_claude.exists():
            files.append({
                "path": str(project_claude),
                "label": f"{p['name']}/CLAUDE.md",
                "category": "project",
                "project_name": p["name"],
            })

    return files


@router.get("")
async def read_claude_md(path: str = Query(..., description="Absolute path to the file")):
    """Read a CLAUDE.md or rules file."""
    file_path = Path(path)

    if not _is_safe_path(file_path):
        raise HTTPException(status_code=403, detail="Path not allowed")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    content = file_path.read_text(encoding="utf-8")
    return {"path": str(file_path), "content": content}


@router.put("")
async def write_claude_md(data: ClaudeMdWrite):
    """Write content to a CLAUDE.md or rules file (auto-save target)."""
    file_path = Path(data.path)

    if not _is_safe_path(file_path):
        raise HTTPException(status_code=403, detail="Path not allowed")

    # Create parent directory if needed (e.g., for new project CLAUDE.md)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(data.content, encoding="utf-8")

    logger.info("Wrote CLAUDE.md: %s (%d bytes)", file_path, len(data.content))
    return {"path": str(file_path), "size": len(data.content)}
