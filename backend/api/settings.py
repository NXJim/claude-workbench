"""Settings API — key-value configuration store."""

import json
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Setting
from config import PROJECTS_ROOT

router = APIRouter(prefix="/settings", tags=["settings"])

# Default project categories (used when no DB row exists)
DEFAULT_PROJECT_CATEGORIES = [
    {"name": "web", "emoji": "\U0001F310", "color": "blue"},
    {"name": "apps", "emoji": "\U0001F4F1", "color": "purple"},
    {"name": "tools", "emoji": "\U0001F527", "color": "amber"},
    {"name": "data", "emoji": "\U0001F4CA", "color": "emerald"},
]

VALID_COLORS = {"blue", "purple", "amber", "emerald", "red", "pink", "cyan", "orange"}
CATEGORY_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Default values for settings (used when no DB row exists)
DEFAULTS = {
    "projects_root": str(PROJECTS_ROOT),
}


class ProjectCategory(BaseModel):
    name: str
    emoji: str
    color: str


class SettingsResponse(BaseModel):
    projects_root: str
    project_categories: list[ProjectCategory]


class SettingsUpdate(BaseModel):
    projects_root: Optional[str] = None
    project_categories: Optional[list[ProjectCategory]] = None


def _validate_categories(categories: list[ProjectCategory]) -> None:
    """Validate category list: non-empty names, no duplicates, at least one."""
    if not categories:
        raise HTTPException(status_code=400, detail="At least one project category is required")

    seen_names: set[str] = set()
    for cat in categories:
        name = cat.name.strip().lower()
        if not name:
            raise HTTPException(status_code=400, detail="Category name cannot be empty")
        if not CATEGORY_NAME_RE.match(name):
            raise HTTPException(
                status_code=400,
                detail=f"Category name '{name}' must be lowercase alphanumeric with hyphens only"
            )
        if name in seen_names:
            raise HTTPException(status_code=400, detail=f"Duplicate category name: '{name}'")
        if cat.color not in VALID_COLORS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid color '{cat.color}'. Must be one of: {', '.join(sorted(VALID_COLORS))}"
            )
        seen_names.add(name)


async def get_project_categories(db: AsyncSession) -> list[dict]:
    """Read project categories from DB, falling back to defaults."""
    result = await db.execute(select(Setting).where(Setting.key == "project_categories"))
    row = result.scalar_one_or_none()
    if row:
        try:
            return json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            pass
    return DEFAULT_PROJECT_CATEGORIES


@router.get("", response_model=SettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Get all settings, falling back to defaults for missing keys."""
    result = await db.execute(select(Setting))
    rows = {row.key: row.value for row in result.scalars().all()}

    # Parse project categories from JSON
    categories = DEFAULT_PROJECT_CATEGORIES
    if "project_categories" in rows:
        try:
            categories = json.loads(rows["project_categories"])
        except (json.JSONDecodeError, TypeError):
            pass

    return SettingsResponse(
        projects_root=rows.get("projects_root", DEFAULTS["projects_root"]),
        project_categories=[ProjectCategory(**c) for c in categories],
    )


@router.put("", response_model=SettingsResponse)
async def update_settings(data: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    """Update settings. Only provided fields are changed."""
    # Validate categories if provided
    if data.project_categories is not None:
        _validate_categories(data.project_categories)

    # Build updates dict, serializing categories as JSON
    updates: dict[str, str] = {}
    if data.projects_root is not None:
        updates["projects_root"] = data.projects_root
    if data.project_categories is not None:
        updates["project_categories"] = json.dumps(
            [c.model_dump() for c in data.project_categories]
        )

    for key, value in updates.items():
        existing = await db.execute(select(Setting).where(Setting.key == key))
        row = existing.scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))

    await db.commit()

    # Return current state
    return await get_settings(db)
