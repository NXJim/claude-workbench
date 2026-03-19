"""Create new projects with scaffolding (folder, git, CLAUDE.md, etc.)."""

import json
import logging
import subprocess
from datetime import date
from pathlib import Path
from typing import Optional

from config import PROJECTS_ROOT, PUBLIC_HOST

logger = logging.getLogger(__name__)


def create_project(
    name: str,
    project_type: str,
    description: str = "",
    tech_stack: str = "",
    backend_port: Optional[int] = None,
    frontend_port: Optional[int] = None,
    valid_types: list[str] | None = None,
    projects_root: Path | None = None,
) -> dict:
    """
    Create a new project with full scaffolding.
    Returns {path, name, type, created_files}.
    valid_types defaults to ["web", "apps", "tools", "data"] if not provided.
    projects_root defaults to PROJECTS_ROOT from config if not provided.
    """
    root = projects_root or PROJECTS_ROOT
    types = valid_types if valid_types is not None else ["web", "apps", "tools", "data"]

    # Validate inputs
    if project_type not in types:
        raise ValueError(f"Invalid project type '{project_type}'. Must be one of: {types}")

    # Sanitize name: lowercase, hyphens only
    safe_name = name.lower().strip().replace(" ", "-")
    safe_name = "".join(c for c in safe_name if c.isalnum() or c == "-")
    if not safe_name:
        raise ValueError("Project name is empty after sanitization")

    project_dir = root / project_type / safe_name
    if project_dir.exists():
        raise ValueError(f"Project directory already exists: {project_dir}")

    # Create directory
    project_dir.mkdir(parents=True)
    created_files = []

    try:
        # 1. git init
        subprocess.run(
            ["git", "init"], cwd=str(project_dir),
            capture_output=True, text=True, timeout=10
        )
        created_files.append(".git/")

        # 2. CLAUDE.md with project-specific info
        claude_md = _generate_claude_md(
            name=name, safe_name=safe_name, project_type=project_type,
            description=description, tech_stack=tech_stack,
            backend_port=backend_port, frontend_port=frontend_port,
            project_dir=project_dir,
        )
        (project_dir / "CLAUDE.md").write_text(claude_md)
        created_files.append("CLAUDE.md")

        # 3. CHANGELOG.md
        today = date.today().isoformat()
        changelog = f"# Changelog\n\n## {today} — Project created\n\n- Initial project scaffolding\n"
        (project_dir / "CHANGELOG.md").write_text(changelog)
        created_files.append("CHANGELOG.md")

        # 4. TODO.md
        todo = f"# TODO\n\nLast Updated: {today}\n\n## Setup\n- [ ] Initial implementation\n"
        (project_dir / "TODO.md").write_text(todo)
        created_files.append("TODO.md")

        # 5. IDEAS.md
        ideas = "# Ideas\n\nCapture exploratory or speculative ideas here. Promote to TODO.md when actionable.\n"
        (project_dir / "IDEAS.md").write_text(ideas)
        created_files.append("IDEAS.md")

        # 6. .gitignore
        gitignore = _generate_gitignore(project_type)
        (project_dir / ".gitignore").write_text(gitignore)
        created_files.append(".gitignore")

        # 7. .workbench.json (dev ports for Workbench link buttons)
        if backend_port or frontend_port:
            wb_config = {}
            if backend_port:
                wb_config["backend_port"] = backend_port
            if frontend_port:
                wb_config["frontend_port"] = frontend_port
            (project_dir / ".workbench.json").write_text(
                json.dumps(wb_config, indent=2) + "\n"
            )
            created_files.append(".workbench.json")

        # 8. Initial git commit
        subprocess.run(
            ["git", "add", "-A"], cwd=str(project_dir),
            capture_output=True, text=True, timeout=10
        )
        subprocess.run(
            ["git", "commit", "-m", "Initial project scaffolding"],
            cwd=str(project_dir),
            capture_output=True, text=True, timeout=10
        )

        return {
            "path": str(project_dir),
            "name": safe_name,
            "display_name": name,
            "type": project_type,
            "created_files": created_files,
        }

    except Exception as e:
        # If something fails mid-creation, log but don't clean up
        # (partial creation is better than data loss)
        logger.error("Project creation error for %s: %s", safe_name, e)
        raise


def _generate_claude_md(
    name: str, safe_name: str, project_type: str,
    description: str, tech_stack: str,
    backend_port: Optional[int], frontend_port: Optional[int],
    project_dir: Path,
) -> str:
    """Generate a CLAUDE.md file tailored to the project."""
    lines = [f"# {name}\n"]

    if description:
        lines.append(f"{description}\n")

    # Tech stack
    if tech_stack:
        lines.append("## Tech Stack")
        lines.append(f"{tech_stack}\n")

    # Ports
    if backend_port or frontend_port:
        lines.append("## Ports")
        if backend_port:
            lines.append(f"- Backend: {backend_port}")
        if frontend_port:
            lines.append(f"- Frontend: {frontend_port}")
        lines.append("")

    # URLs (use configured public host)
    if backend_port or frontend_port:
        lines.append("## URLs")
        if frontend_port:
            lines.append(f"- Frontend: http://{PUBLIC_HOST}:{frontend_port}")
        if backend_port:
            lines.append(f"- Backend API: http://{PUBLIC_HOST}:{backend_port}/api")
        lines.append("")

    # Workbench integration
    if backend_port or frontend_port:
        lines.append("## Workbench Integration")
        lines.append("This project has a `.workbench.json` file that tells Claude Workbench about its dev ports.")
        lines.append("If you change the dev server ports, update `.workbench.json` to match so the")
        lines.append("Workbench sidebar link button opens the correct URL.")
        lines.append("")

    # Project location
    lines.append("## Project Location")
    lines.append(f"`{project_dir}/`\n")

    return "\n".join(lines)


def _generate_gitignore(project_type: str) -> str:
    """Generate a .gitignore appropriate for the project type."""
    common = [
        "# Python",
        "venv/",
        ".venv/",
        "__pycache__/",
        "*.pyc",
        ".pytest_cache/",
        "",
        "# Node",
        "node_modules/",
        "dist/",
        "",
        "# Environment",
        ".env",
        ".env.local",
        "",
        "# IDE",
        ".vscode/",
        ".idea/",
        "",
        "# OS",
        ".DS_Store",
        "Thumbs.db",
        "",
    ]
    return "\n".join(common)
