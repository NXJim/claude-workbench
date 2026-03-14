"""Layout preset and active layout endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import LayoutPreset, ActiveLayout
from schemas import LayoutPresetCreate, LayoutPresetResponse, ActiveLayoutUpdate, ActiveLayoutResponse

router = APIRouter(tags=["layouts"])


@router.get("/layouts", response_model=list[LayoutPresetResponse])
async def list_layout_presets(db: AsyncSession = Depends(get_db)):
    """List all layout presets."""
    result = await db.execute(select(LayoutPreset).order_by(LayoutPreset.id))
    return result.scalars().all()


@router.post("/layouts", response_model=LayoutPresetResponse)
async def create_layout_preset(data: LayoutPresetCreate, db: AsyncSession = Depends(get_db)):
    """Save a new layout preset."""
    preset = LayoutPreset(name=data.name, layout_json=data.layout_json)
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/layouts/{preset_id}")
async def delete_layout_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a layout preset."""
    result = await db.execute(select(LayoutPreset).where(LayoutPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    await db.delete(preset)
    await db.commit()
    return {"status": "deleted"}


@router.get("/layout/active", response_model=ActiveLayoutResponse)
async def get_active_layout(db: AsyncSession = Depends(get_db)):
    """Get the current active layout state."""
    result = await db.execute(select(ActiveLayout).where(ActiveLayout.id == 1))
    layout = result.scalar_one_or_none()
    if not layout:
        return ActiveLayoutResponse(
            tiling_json=None, floating_json=None,
            sidebar_collapsed=False, sidebar_width=280,
        )
    return layout


@router.put("/layout/active", response_model=ActiveLayoutResponse)
async def save_active_layout(data: ActiveLayoutUpdate, db: AsyncSession = Depends(get_db)):
    """Save the current layout state."""
    result = await db.execute(select(ActiveLayout).where(ActiveLayout.id == 1))
    layout = result.scalar_one_or_none()
    if not layout:
        layout = ActiveLayout(id=1)
        db.add(layout)

    if data.tiling_json is not None:
        layout.tiling_json = data.tiling_json
    if data.floating_json is not None:
        layout.floating_json = data.floating_json
    if data.sidebar_collapsed is not None:
        layout.sidebar_collapsed = 1 if data.sidebar_collapsed else 0
    if data.sidebar_width is not None:
        layout.sidebar_width = data.sidebar_width
    if data.sidebar_section_ratios is not None:
        import json
        layout.sidebar_section_ratios = json.dumps(data.sidebar_section_ratios)

    await db.commit()
    await db.refresh(layout)
    return layout
