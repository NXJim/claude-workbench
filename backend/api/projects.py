"""Project discovery and creation endpoints."""

import logging
import re
import shutil
import subprocess
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session, Setting
from config import PROJECTS_ROOT
from schemas import ProjectInfo
from services.project_discovery import discover_projects
from services.project_creator import create_project
from api.settings import get_project_categories

logger = logging.getLogger(__name__)
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


class ProjectMoveRequest(BaseModel):
    project_path: str       # Current full path
    target_category: str    # Target category folder name


@router.post("/move")
async def move_project(req: ProjectMoveRequest, db: AsyncSession = Depends(get_db)):
    """Move a project folder from one category to another on disk."""
    src = Path(req.project_path)
    if not src.is_dir():
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify target category folder exists
    projects_root = await _get_projects_root(db)
    target_dir = projects_root / req.target_category
    if not target_dir.is_dir():
        raise HTTPException(
            status_code=400,
            detail=f"Category '{req.target_category}' does not exist",
        )

    dest = target_dir / src.name
    if dest.exists():
        raise HTTPException(
            status_code=409,
            detail=f"A project named '{src.name}' already exists in '{req.target_category}'",
        )

    # Block move if any live sessions reference this project
    result = await db.execute(
        select(func.count(Session.id)).where(
            Session.project_path == str(src), Session.is_alive == 1
        )
    )
    alive_count = result.scalar() or 0
    if alive_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot move: {alive_count} active session(s). Terminate them first.",
        )

    # Move the folder on disk
    try:
        shutil.move(str(src), str(dest))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Move failed: {e}")

    # Update dead session records to point to the new path
    await db.execute(
        update(Session)
        .where(Session.project_path == str(src))
        .values(project_path=str(dest))
    )
    await db.commit()

    logger.info("Moved project %s -> %s", src, dest)
    return {"old_path": str(src), "new_path": str(dest)}


def _parse_ufw_rules() -> list[dict]:
    """Parse UFW status output into a list of rule dicts.

    Uses `sudo -n` (non-interactive) to avoid hanging on password prompts.
    Falls back to empty list if sudo is not passwordless or ufw is not installed.
    """
    try:
        result = subprocess.run(
            ["sudo", "-n", "ufw", "status"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []

    rules = []
    seen = set()  # Deduplicate IPv4/v6 entries
    for line in result.stdout.splitlines():
        line = line.strip()
        # Skip IPv6 duplicates (lines containing "(v6)")
        if "(v6)" in line:
            continue
        # Match lines like: "8000/tcp  ALLOW  Anywhere  # comment"
        # Also handle named rules like: "Samba  ALLOW  Anywhere"
        m = re.match(
            r"^(\S+(?:/\w+)?)\s+(ALLOW|DENY|REJECT|LIMIT)\s+\S+(?:\s+#\s*(.*))?$",
            line,
        )
        if not m:
            continue
        port_proto = m.group(1)
        action = m.group(2)
        comment = (m.group(3) or "").strip()

        # Deduplicate by port_proto
        if port_proto in seen:
            continue
        seen.add(port_proto)

        # Parse port number and protocol from e.g. "8000/tcp"
        if "/" in port_proto:
            port_str, protocol = port_proto.split("/", 1)
        else:
            port_str, protocol = port_proto, None
        try:
            port = int(port_str)
        except ValueError:
            port = None
        rules.append({
            "port": port,
            "port_proto": port_proto,
            "protocol": protocol,
            "action": action,
            "comment": comment,
        })
    return rules


@router.get("/ports")
async def get_ports_overview(db: AsyncSession = Depends(get_db)):
    """Return all project ports with UFW open/closed status."""
    projects_root = await _get_projects_root(db)
    categories = await get_project_categories(db)
    category_names = [c["name"] for c in categories]
    projects = discover_projects(projects_root, project_types=category_names)

    ufw_rules = _parse_ufw_rules()
    open_ports = {r["port"] for r in ufw_rules if r["action"] == "ALLOW" and r["port"] is not None}

    project_ports = []
    for p in projects:
        ports = p.get("dev_ports") or {}
        bp = ports.get("backend")
        fp = ports.get("frontend")
        if bp is None and fp is None:
            continue
        project_ports.append({
            "project": p.get("display_name") or p["name"],
            "project_name": p["name"],
            "type": p["type"],
            "backend_port": bp,
            "backend_ufw": bp in open_ports if bp is not None else False,
            "frontend_port": fp,
            "frontend_ufw": fp in open_ports if fp is not None else False,
        })

    return {"project_ports": project_ports, "ufw_rules": ufw_rules}
