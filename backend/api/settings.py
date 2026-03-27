"""Settings API — key-value configuration store."""

import json
import logging
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Setting
from config import PROJECTS_ROOT

logger = logging.getLogger(__name__)

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
    """Read project categories from DB (or defaults), then merge any
    filesystem directories not already listed so every category appears
    in the sidebar — even newly-created or renamed ones."""
    result = await db.execute(select(Setting).where(Setting.key == "project_categories"))
    row = result.scalar_one_or_none()
    if row:
        try:
            categories = json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            categories = list(DEFAULT_PROJECT_CATEGORIES)
    else:
        categories = list(DEFAULT_PROJECT_CATEGORIES)

    # Resolve projects root from DB or config default
    root_result = await db.execute(select(Setting).where(Setting.key == "projects_root"))
    root_row = root_result.scalar_one_or_none()
    projects_root = Path(root_row.value).expanduser() if root_row else PROJECTS_ROOT

    # Discover directories on disk and merge any that aren't in the list
    known_names = {c["name"] for c in categories}
    if projects_root.is_dir():
        for entry in sorted(projects_root.iterdir()):
            if entry.is_dir() and not entry.name.startswith(".") and entry.name not in known_names:
                categories.append({"name": entry.name, "emoji": "\U0001F4C1", "color": "blue"})
                known_names.add(entry.name)

    return categories


@router.get("", response_model=SettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Get all settings, falling back to defaults for missing keys."""
    result = await db.execute(select(Setting))
    rows = {row.key: row.value for row in result.scalars().all()}

    # Use get_project_categories() which merges DB + filesystem
    categories = await get_project_categories(db)

    return SettingsResponse(
        projects_root=rows.get("projects_root", DEFAULTS["projects_root"]),
        project_categories=[ProjectCategory(**c) for c in categories],
    )


def _get_projects_root(db_rows: dict[str, str]) -> Path:
    """Resolve the projects root from DB or config default."""
    return Path(db_rows.get("projects_root", str(PROJECTS_ROOT))).expanduser()


def _sync_category_folders(
    projects_root: Path,
    old_categories: list[dict],
    new_categories: list[dict],
) -> list[str]:
    """
    Sync category folders on disk to match the new category list.
    Returns a list of warnings (non-fatal issues).

    Strategy:
    - Detect renames by comparing old/new lists by index position
      (the UI edits categories in-place, so index = identity).
    - New names not accounted for by renames → create folder.
    - Removed names → left on disk (never delete project folders).
    """
    warnings: list[str] = []
    old_names = [c["name"] for c in old_categories]
    new_names = [c["name"] for c in new_categories]

    # Index-based rename detection: if old[i] changed to new[i],
    # and old[i] folder exists, rename it.
    renamed_old: set[str] = set()   # old names consumed by renames
    renamed_new: set[str] = set()   # new names fulfilled by renames

    for i in range(min(len(old_names), len(new_names))):
        if old_names[i] != new_names[i]:
            src = projects_root / old_names[i]
            dst = projects_root / new_names[i]
            if src.is_dir() and not dst.exists():
                try:
                    src.rename(dst)
                    logger.info("Renamed category folder: %s → %s", src, dst)
                    renamed_old.add(old_names[i])
                    renamed_new.add(new_names[i])
                except OSError as e:
                    warnings.append(f"Failed to rename {old_names[i]} → {new_names[i]}: {e}")
            elif src.is_dir() and dst.exists():
                warnings.append(
                    f"Cannot rename {old_names[i]} → {new_names[i]}: "
                    f"target folder already exists"
                )
            # If src doesn't exist, treat new_names[i] as a fresh create below

    # Create folders for genuinely new categories (not fulfilled by renames)
    for name in new_names:
        if name not in renamed_new:
            folder = projects_root / name
            if not folder.exists():
                try:
                    folder.mkdir(parents=True)
                    logger.info("Created category folder: %s", folder)
                except OSError as e:
                    warnings.append(f"Failed to create folder {name}: {e}")

    return warnings


@router.put("", response_model=SettingsResponse)
async def update_settings(data: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    """Update settings. Only provided fields are changed."""
    # Validate categories if provided
    if data.project_categories is not None:
        _validate_categories(data.project_categories)

    # Load current DB state for comparison
    result = await db.execute(select(Setting))
    db_rows = {row.key: row.value for row in result.scalars().all()}

    # Sync category folders on disk before saving
    if data.project_categories is not None:
        old_categories = await get_project_categories(db)
        projects_root = _get_projects_root(db_rows)
        _sync_category_folders(
            projects_root,
            old_categories,
            [c.model_dump() for c in data.project_categories],
        )

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
