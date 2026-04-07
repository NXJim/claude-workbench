"""Skills API — discover and edit Claude Code skill files."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.skill_discovery import list_skills, get_skill_content, update_skill_content

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillUpdateRequest(BaseModel):
    content: str


@router.get("")
async def list_all_skills():
    """List all discovered skills (custom + plugin)."""
    return list_skills()


@router.get("/detail")
async def get_skill(path: str = Query(..., description="Absolute path to the SKILL.md file")):
    """Get full content of a skill file."""
    result = get_skill_content(path)
    if not result:
        raise HTTPException(status_code=404, detail="Skill not found")
    return result


@router.put("/detail")
async def update_skill(
    data: SkillUpdateRequest,
    path: str = Query(..., description="Absolute path to the SKILL.md file"),
):
    """Update a skill file's content. Only custom skills can be edited."""
    # Check if the skill exists and is writable
    existing = get_skill_content(path)
    if not existing:
        raise HTTPException(status_code=404, detail="Skill not found")
    if existing.get("readonly"):
        raise HTTPException(status_code=403, detail="Plugin skills are read-only")

    result = update_skill_content(path, data.content)
    if not result:
        raise HTTPException(status_code=500, detail="Failed to save skill content")
    return result
