"""Health checking service — TCP port checks, HTTP health endpoints."""

import asyncio
import logging
import subprocess
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


async def check_tcp_port(port: int, host: str = "127.0.0.1", timeout: float = 2.0) -> bool:
    """Check if a TCP port is listening."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
        return False


async def check_http_health(url: str, timeout: float = 5.0) -> bool:
    """Check if an HTTP endpoint returns 2xx."""
    try:
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            resp = await client.get(url)
            return resp.is_success
    except Exception:
        return False


def check_systemd_service(service_name: str) -> Optional[str]:
    """Check systemd service status. Returns 'active', 'inactive', 'failed', etc."""
    try:
        result = subprocess.run(
            ["systemctl", "is-active", service_name],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return None


async def check_project_health(
    backend_port: Optional[int] = None,
    frontend_port: Optional[int] = None,
    health_endpoint: Optional[str] = None,
) -> dict:
    """
    Check health of a project's dev services.
    Returns {backend: "up"|"down"|null, frontend: "up"|"down"|null}.
    """
    result = {"backend": None, "frontend": None}

    tasks = []

    if backend_port is not None:
        async def check_backend():
            up = await check_tcp_port(backend_port)
            # If port is up and there's a health endpoint, also check HTTP
            if up and health_endpoint:
                url = f"http://127.0.0.1:{backend_port}{health_endpoint}"
                up = await check_http_health(url)
            result["backend"] = "up" if up else "down"

        tasks.append(check_backend())

    if frontend_port is not None:
        async def check_frontend():
            up = await check_tcp_port(frontend_port)
            result["frontend"] = "up" if up else "down"

        tasks.append(check_frontend())

    if tasks:
        await asyncio.gather(*tasks)

    return result


async def check_all_projects_health(projects: list[dict]) -> dict[str, dict]:
    """Check health for all projects. Returns {project_path: health_status}."""
    results = {}

    async def check_one(project: dict):
        dev_ports = project.get("dev_ports", {})
        health_endpoint = project.get("health_endpoint")
        health = await check_project_health(
            backend_port=dev_ports.get("backend"),
            frontend_port=dev_ports.get("frontend"),
            health_endpoint=health_endpoint,
        )
        results[project["path"]] = health

    await asyncio.gather(*[check_one(p) for p in projects])
    return results
