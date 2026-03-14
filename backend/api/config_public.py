"""Public configuration endpoint — returns dynamic paths for the current user."""

from pathlib import Path

from fastapi import APIRouter

from config import PROJECTS_ROOT

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/public")
async def get_public_config():
    """Return user-specific paths (no secrets). Used by frontend to avoid hardcoded paths."""
    home = Path.home()
    return {
        "home_dir": str(home),
        "projects_root": str(PROJECTS_ROOT),
        "global_claude_md_path": str(home / ".claude" / "CLAUDE.md"),
    }
