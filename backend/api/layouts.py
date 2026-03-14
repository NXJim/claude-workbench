"""Layout preset and active layout endpoints."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import LayoutPreset, ActiveLayout, Session

logger = logging.getLogger(__name__)
from schemas import (
    LayoutPresetCreate, LayoutPresetUpdate, LayoutPresetResponse,
    ActiveLayoutUpdate, ActiveLayoutResponse,
)

router = APIRouter(tags=["layouts"])


@router.get("/layouts", response_model=list[LayoutPresetResponse])
async def list_layout_presets(db: AsyncSession = Depends(get_db)):
    """List all layout presets."""
    result = await db.execute(select(LayoutPreset).order_by(LayoutPreset.id))
    return result.scalars().all()


@router.post("/layouts", response_model=LayoutPresetResponse)
async def create_layout_preset(data: LayoutPresetCreate, db: AsyncSession = Depends(get_db)):
    """Save a new layout preset or workspace."""
    preset = LayoutPreset(
        name=data.name,
        layout_json=data.layout_json,
        floating_json=data.floating_json,
        is_workspace=1 if data.is_workspace else 0,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


@router.put("/layouts/{preset_id}", response_model=LayoutPresetResponse)
async def update_layout_preset(preset_id: int, data: LayoutPresetUpdate, db: AsyncSession = Depends(get_db)):
    """Update an existing preset/workspace. Rejects updates to default presets."""
    result = await db.execute(select(LayoutPreset).where(LayoutPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    if preset.is_default:
        raise HTTPException(status_code=403, detail="Cannot modify default presets")

    if data.name is not None:
        preset.name = data.name
    if data.layout_json is not None:
        preset.layout_json = data.layout_json
    if data.floating_json is not None:
        preset.floating_json = data.floating_json

    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/layouts/{preset_id}")
async def delete_layout_preset(
    preset_id: int,
    terminate_sessions: bool = Query(False, description="Kill sessions owned by this workspace"),
    db: AsyncSession = Depends(get_db),
):
    """Delete a layout preset. For workspaces, guards against deleting the last one."""
    result = await db.execute(select(LayoutPreset).where(LayoutPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    # Last-workspace protection
    if preset.is_workspace:
        ws_count_result = await db.execute(
            select(func.count()).select_from(LayoutPreset).where(LayoutPreset.is_workspace == 1)
        )
        ws_count = ws_count_result.scalar()
        if ws_count <= 1:
            raise HTTPException(status_code=403, detail="Cannot delete the last workspace")

    # Terminate sessions owned by this workspace if requested
    if terminate_sessions and preset.is_workspace:
        from services.ttyd_manager import ttyd_manager
        from services.activity_monitor import activity_monitor
        from services.tmux_manager import kill_session as kill_tmux

        sess_result = await db.execute(
            select(Session).where(Session.workspace_id == preset_id, Session.is_alive == 1)
        )
        for s in sess_result.scalars().all():
            ttyd_manager.stop(s.id)
            activity_monitor.untrack_session(s.id)
            kill_tmux(s.tmux_name)
            await db.delete(s)
            logger.info("Terminated session %s for workspace deletion", s.id)

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
        layout.sidebar_section_ratios = json.dumps(data.sidebar_section_ratios)
    if data.active_workspace_id is not None:
        layout.active_workspace_id = data.active_workspace_id
    # Allow clearing active workspace by sending 0
    if data.active_workspace_id == 0:
        layout.active_workspace_id = None

    await db.commit()
    await db.refresh(layout)
    return layout
