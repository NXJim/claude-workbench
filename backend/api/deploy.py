"""Deploy pipeline endpoints."""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional

from services.deploy_config import load_deploy_config
from services.deployer import deployer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/deploy", tags=["deploy"])


class DeployRequest(BaseModel):
    skip_build: bool = False
    dry_run: bool = False


@router.get("/{project_name}/config")
async def get_deploy_config(project_name: str):
    """Get parsed deploy.yaml for a project."""
    from services.project_discovery import discover_projects
    projects = discover_projects()
    project = next((p for p in projects if p["name"] == project_name), None)
    if not project:
        return {"error": "Project not found"}

    config = load_deploy_config(project["path"])
    if not config:
        return {"error": "No deploy.yaml found"}

    return config.model_dump()


@router.post("/{project_name}")
async def trigger_deploy(project_name: str, req: DeployRequest):
    """Trigger a deploy for a project. Runs in background."""
    from services.project_discovery import discover_projects
    projects = discover_projects()
    project = next((p for p in projects if p["name"] == project_name), None)
    if not project:
        return {"error": "Project not found"}

    config = load_deploy_config(project["path"])
    if not config:
        return {"error": "No deploy.yaml found"}

    if deployer.is_deploying(project["path"]):
        return {"error": "Deploy already in progress"}

    # Run deploy as a background task
    async def run_deploy():
        await deployer.deploy(
            project_path=project["path"],
            config=config,
            skip_build=req.skip_build,
            dry_run=req.dry_run,
        )

    task = asyncio.create_task(run_deploy())
    deployer.active_deploys[project["path"]] = task

    return {"status": "started", "project": project_name, "dry_run": req.dry_run}


@router.get("/{project_name}/status")
async def get_deploy_status(project_name: str):
    """Get last deploy info for a project."""
    from services.project_discovery import discover_projects
    projects = discover_projects()
    project = next((p for p in projects if p["name"] == project_name), None)
    if not project:
        return {"error": "Project not found"}

    return {
        "deploying": deployer.is_deploying(project["path"]),
        "last_deploy": project.get("last_deploy"),
    }


@router.get("/{project_name}/log")
async def get_deploy_log(project_name: str):
    """Get deploy log contents for a project."""
    from services.project_discovery import discover_projects
    from pathlib import Path

    projects = discover_projects()
    project = next((p for p in projects if p["name"] == project_name), None)
    if not project:
        return {"error": "Project not found"}

    log_file = Path(project["path"]) / "deploy.log"
    if not log_file.exists():
        return {"log": "", "exists": False}

    return {"log": log_file.read_text(), "exists": True}


# WebSocket for deploy progress streaming
@router.websocket("/{project_name}/ws")
async def deploy_ws(websocket: WebSocket, project_name: str):
    """
    WebSocket endpoint for streaming deploy progress.
    Query params: skip_build, dry_run
    """
    await websocket.accept()

    from services.project_discovery import discover_projects
    projects = discover_projects()
    project = next((p for p in projects if p["name"] == project_name), None)
    if not project:
        await websocket.send_json({"type": "error", "message": "Project not found"})
        await websocket.close()
        return

    config = load_deploy_config(project["path"])
    if not config:
        await websocket.send_json({"type": "error", "message": "No deploy.yaml found"})
        await websocket.close()
        return

    if deployer.is_deploying(project["path"]):
        await websocket.send_json({"type": "error", "message": "Deploy already in progress"})
        await websocket.close()
        return

    # Parse options from first message
    try:
        msg = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        skip_build = msg.get("skip_build", False)
        dry_run = msg.get("dry_run", False)
    except (asyncio.TimeoutError, Exception):
        skip_build = False
        dry_run = False

    # Stream output via WebSocket
    async def on_output(line: str):
        try:
            await websocket.send_json({"type": "log", "line": line})
        except Exception:
            pass

    try:
        await websocket.send_json({"type": "status", "status": "started"})

        result = await deployer.deploy(
            project_path=project["path"],
            config=config,
            on_output=on_output,
            skip_build=skip_build,
            dry_run=dry_run,
        )

        await websocket.send_json({"type": "status", "status": result["status"], "result": result})
    except WebSocketDisconnect:
        logger.info("Deploy WebSocket disconnected for %s", project_name)
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
