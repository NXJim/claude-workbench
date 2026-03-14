"""Scan projects root for project directories with git info."""

import json
import logging
import subprocess
from pathlib import Path
from typing import Optional

from config import PROJECTS_ROOT

logger = logging.getLogger(__name__)


def _get_git_info(project_path: Path) -> Optional[dict]:
    """Get git branch, dirty status, and last commit message."""
    if not (project_path / ".git").exists():
        return None

    try:
        # Branch name
        branch_result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(project_path), capture_output=True, text=True, timeout=5
        )
        branch = branch_result.stdout.strip() if branch_result.returncode == 0 else None

        # Dirty check
        dirty_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(project_path), capture_output=True, text=True, timeout=5
        )
        dirty = bool(dirty_result.stdout.strip()) if dirty_result.returncode == 0 else False

        # Last commit message
        msg_result = subprocess.run(
            ["git", "log", "-1", "--format=%s"],
            cwd=str(project_path), capture_output=True, text=True, timeout=5
        )
        last_commit_msg = msg_result.stdout.strip() if msg_result.returncode == 0 else None

        return {
            "branch": branch,
            "dirty": dirty,
            "last_commit_msg": last_commit_msg,
        }
    except Exception as e:
        logger.debug("Git info failed for %s: %s", project_path, e)
        return None


def discover_projects(
    projects_root: Path | None = None,
    project_types: list[str] | None = None,
) -> list[dict]:
    """
    Scan projects_root/<type>/ for project directories.
    Falls back to PROJECTS_ROOT from config if not provided.
    project_types defaults to ["web", "apps", "tools", "data"] if not provided.
    Returns list of project dicts with git info.
    """
    root = projects_root or PROJECTS_ROOT
    types = project_types if project_types is not None else ["web", "apps", "tools", "data"]
    projects = []

    for ptype in types:
        type_dir = root / ptype
        if not type_dir.is_dir():
            continue

        for entry in sorted(type_dir.iterdir()):
            if not entry.is_dir():
                continue
            # Skip hidden directories
            if entry.name.startswith("."):
                continue

            project = {
                "name": entry.name,
                "path": str(entry),
                "type": ptype,
                "has_claude_md": (entry / "CLAUDE.md").exists(),
                "display_name": None,
            }

            # Git info
            project["git_info"] = _get_git_info(entry)

            # Quick actions from .workbench-actions.json
            actions_file = entry / ".workbench-actions.json"
            if actions_file.exists():
                try:
                    with open(actions_file) as f:
                        project["actions"] = json.load(f)
                except Exception:
                    project["actions"] = []
            else:
                project["actions"] = []

            projects.append(project)

    return projects
