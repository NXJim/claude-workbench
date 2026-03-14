"""Pydantic models for deploy.yaml configuration."""

import logging
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ProjectMeta(BaseModel):
    name: str
    type: str  # web, apps, tools, data


class DevConfig(BaseModel):
    backend_port: Optional[int] = None
    frontend_port: Optional[int] = None
    health_endpoint: Optional[str] = None
    venv: Optional[str] = None


class ProdConfig(BaseModel):
    host: Optional[str] = None
    ssh_user: Optional[str] = None
    ssh_key: Optional[str] = None
    remote_path: Optional[str] = None
    backend_port: Optional[int] = None
    systemd_service: Optional[str] = None
    health_url: Optional[str] = None


class BuildFrontend(BaseModel):
    dir: str
    command: str


class BuildConfig(BaseModel):
    frontend: Optional[BuildFrontend] = None


class SyncRule(BaseModel):
    source: str
    dest: str
    delete: bool = False
    exclude: list[str] = []


class PostDeployStep(BaseModel):
    command: str
    description: str = ""


class DeployConfig(BaseModel):
    project: ProjectMeta
    dev: Optional[DevConfig] = None
    prod: Optional[ProdConfig] = None
    build: Optional[BuildConfig] = None
    sync: list[SyncRule] = []
    post_deploy: list[PostDeployStep] = []
    deploy_script: Optional[str] = None


def load_deploy_config(project_path: str) -> Optional[DeployConfig]:
    """Load and parse deploy.yaml from a project directory."""
    deploy_file = Path(project_path) / "deploy.yaml"
    if not deploy_file.exists():
        return None

    try:
        with open(deploy_file) as f:
            data = yaml.safe_load(f)
        if not data:
            return None

        # Expand ~ in ssh_key and deploy_script paths
        if data.get("prod", {}).get("ssh_key"):
            data["prod"]["ssh_key"] = str(Path(data["prod"]["ssh_key"]).expanduser())
        if data.get("deploy_script"):
            data["deploy_script"] = str((Path(project_path) / data["deploy_script"]).resolve())

        return DeployConfig(**data)
    except Exception as e:
        logger.error("Failed to load deploy.yaml from %s: %s", project_path, e)
        return None
