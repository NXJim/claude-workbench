"""File-based notes storage manager.

Global notes live in data/notes/.
Per-project notes live in {project_path}/.workbench-notes/.
Each note is a .md file plus a manifest.json index.
"""

import json
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from config import PROJECT_ROOT

logger = logging.getLogger(__name__)

# Global notes directory
GLOBAL_NOTES_DIR = PROJECT_ROOT / "data" / "notes"


def _notes_dir(scope: str, project_path: Optional[str] = None) -> Path:
    """Get the notes directory for the given scope."""
    if scope == "project" and project_path:
        return Path(project_path) / ".workbench-notes"
    return GLOBAL_NOTES_DIR


def _ensure_dir(notes_dir: Path) -> None:
    """Create the notes directory and manifest if they don't exist."""
    notes_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = notes_dir / "manifest.json"
    if not manifest_path.exists():
        manifest_path.write_text("[]")


def _read_manifest(notes_dir: Path) -> list[dict]:
    """Read the manifest.json index."""
    _ensure_dir(notes_dir)
    manifest_path = notes_dir / "manifest.json"
    try:
        return json.loads(manifest_path.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _write_manifest(notes_dir: Path, manifest: list[dict]) -> None:
    """Write the manifest.json index."""
    _ensure_dir(notes_dir)
    manifest_path = notes_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))


def list_notes(scope: str = "global", project_path: Optional[str] = None) -> list[dict]:
    """List all notes for the given scope."""
    notes_dir = _notes_dir(scope, project_path)
    return _read_manifest(notes_dir)


def create_note(
    title: str,
    content: str = "",
    scope: str = "global",
    project_path: Optional[str] = None,
) -> dict:
    """Create a new note and return its metadata."""
    notes_dir = _notes_dir(scope, project_path)
    _ensure_dir(notes_dir)

    note_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()

    # Write the .md file
    note_path = notes_dir / f"{note_id}.md"
    note_path.write_text(content)

    # Update manifest
    metadata = {
        "id": note_id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "pinned": False,
    }
    manifest = _read_manifest(notes_dir)
    manifest.append(metadata)
    _write_manifest(notes_dir, manifest)

    logger.info("Created note %s in %s", note_id, notes_dir)
    return metadata


def get_note(
    note_id: str,
    scope: str = "global",
    project_path: Optional[str] = None,
) -> Optional[dict]:
    """Get a note's content and metadata."""
    notes_dir = _notes_dir(scope, project_path)
    manifest = _read_manifest(notes_dir)

    metadata = next((n for n in manifest if n["id"] == note_id), None)
    if not metadata:
        return None

    note_path = notes_dir / f"{note_id}.md"
    content = note_path.read_text() if note_path.exists() else ""

    return {**metadata, "content": content}


def update_note_content(
    note_id: str,
    content: str,
    scope: str = "global",
    project_path: Optional[str] = None,
) -> Optional[dict]:
    """Update a note's content (auto-save target)."""
    notes_dir = _notes_dir(scope, project_path)
    manifest = _read_manifest(notes_dir)

    metadata = next((n for n in manifest if n["id"] == note_id), None)
    if not metadata:
        return None

    # Write content
    note_path = notes_dir / f"{note_id}.md"
    note_path.write_text(content)

    # Update timestamp in manifest
    metadata["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_manifest(notes_dir, manifest)

    return metadata


def update_note_metadata(
    note_id: str,
    title: Optional[str] = None,
    pinned: Optional[bool] = None,
    scope: str = "global",
    project_path: Optional[str] = None,
) -> Optional[dict]:
    """Update a note's metadata (title, pinned)."""
    notes_dir = _notes_dir(scope, project_path)
    manifest = _read_manifest(notes_dir)

    metadata = next((n for n in manifest if n["id"] == note_id), None)
    if not metadata:
        return None

    if title is not None:
        metadata["title"] = title
    if pinned is not None:
        metadata["pinned"] = pinned
    metadata["updated_at"] = datetime.now(timezone.utc).isoformat()

    _write_manifest(notes_dir, manifest)
    return metadata


def delete_note(
    note_id: str,
    scope: str = "global",
    project_path: Optional[str] = None,
) -> bool:
    """Delete a note and its file."""
    notes_dir = _notes_dir(scope, project_path)
    manifest = _read_manifest(notes_dir)

    idx = next((i for i, n in enumerate(manifest) if n["id"] == note_id), None)
    if idx is None:
        return False

    manifest.pop(idx)
    _write_manifest(notes_dir, manifest)

    note_path = notes_dir / f"{note_id}.md"
    if note_path.exists():
        note_path.unlink()

    logger.info("Deleted note %s from %s", note_id, notes_dir)
    return True
