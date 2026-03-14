"""Health check endpoints for project services."""

from fastapi import APIRouter

from services.project_discovery import discover_projects
from services.health_checker import check_project_health, check_all_projects_health

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/projects")
async def all_projects_health():
    """Get health status of all projects with configured ports."""
    projects = discover_projects()
    # Filter to projects with at least one port configured
    projects_with_ports = [
        p for p in projects
        if p["dev_ports"]["backend"] is not None or p["dev_ports"]["frontend"] is not None
    ]
    results = await check_all_projects_health(projects_with_ports)
    return results


@router.get("/projects/{project_name}")
async def single_project_health(project_name: str):
    """Get health status of a single project."""
    projects = discover_projects()
    project = next((p for p in projects if p["name"] == project_name), None)
    if not project:
        return {"error": "Project not found"}

    health = await check_project_health(
        backend_port=project["dev_ports"].get("backend"),
        frontend_port=project["dev_ports"].get("frontend"),
        health_endpoint=project.get("health_endpoint"),
    )
    return {"project": project_name, "health": health}
