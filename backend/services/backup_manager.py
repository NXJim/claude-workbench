"""Backup creation, listing, and deletion service."""

import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

BACKUP_DIR = Path.home() / "projects" / "archive" / "backups"

# Exclude these directories from backups
EXCLUDE_PATTERNS = [
    "venv",
    ".venv",
    "node_modules",
    ".git",
    "__pycache__",
    ".pytest_cache",
    "dist",
    ".next",
]


def ensure_backup_dir():
    """Create backup directory if it doesn't exist."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def create_backup(project_path: str, project_name: str, project_type: str) -> dict:
    """
    Create a tar.gz backup of a project.
    Returns {filename, path, size, created_at}.
    """
    ensure_backup_dir()

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{project_type}-{project_name}-{timestamp}.tar.gz"
    backup_path = BACKUP_DIR / filename

    # Build tar exclude args
    exclude_args = []
    for pattern in EXCLUDE_PATTERNS:
        exclude_args += ["--exclude", pattern]

    cmd = [
        "tar", "-czf", str(backup_path),
        *exclude_args,
        "-C", str(Path(project_path).parent),
        Path(project_path).name,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"tar failed: {result.stderr}")
    except subprocess.TimeoutExpired:
        # Clean up partial file
        if backup_path.exists():
            backup_path.unlink()
        raise RuntimeError("Backup timed out after 5 minutes")

    size = backup_path.stat().st_size

    return {
        "filename": filename,
        "path": str(backup_path),
        "size": size,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def list_backups() -> list[dict]:
    """List all backups in the backup directory."""
    ensure_backup_dir()
    backups = []

    for f in sorted(BACKUP_DIR.iterdir(), reverse=True):
        if f.suffix == ".gz" and f.name.endswith(".tar.gz"):
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })

    return backups


def delete_backup(filename: str) -> bool:
    """Delete a backup file. Returns True if deleted."""
    # Sanitize filename — prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("Invalid filename")

    path = BACKUP_DIR / filename
    if not path.exists():
        return False

    path.unlink()
    return True
