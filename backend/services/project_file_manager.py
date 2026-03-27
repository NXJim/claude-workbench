"""Manage plain .md files in project directories.

Project notes live as real .md files in {project}/notes/ — git-tracked,
human-readable. This is separate from the manifest-based notes_manager
which handles global workbench notes.
"""

import re
import logging
from pathlib import Path
from typing import Optional

from config import PROJECTS_ROOT
from services import notes_manager

logger = logging.getLogger(__name__)


def _validate_path(path: Path) -> bool:
    """Security: ensure path is under PROJECTS_ROOT."""
    try:
        path.resolve().relative_to(PROJECTS_ROOT.resolve())
        return True
    except ValueError:
        return False


def slugify(title: str) -> str:
    """Convert a title to a filename-safe slug.

    "API Design Ideas" → "api-design-ideas"
    """
    slug = title.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)  # remove non-word chars (except hyphens)
    slug = re.sub(r'[\s_]+', '-', slug)    # spaces/underscores → hyphens
    slug = re.sub(r'-+', '-', slug)        # collapse multiple hyphens
    slug = slug.strip('-')
    return slug or "untitled"


def resolve_conflict(directory: Path, slug: str) -> str:
    """If {slug}.md exists, return {slug}-2.md, {slug}-3.md, etc. Cap at 99."""
    if not (directory / f"{slug}.md").exists():
        return slug
    for i in range(2, 100):
        candidate = f"{slug}-{i}"
        if not (directory / f"{candidate}.md").exists():
            return candidate
    raise ValueError(f"Too many conflicts for slug '{slug}' in {directory}")


def create_note_file(
    project_path: str,
    title: str,
    content: str = "",
) -> dict:
    """Create a .md file in {project}/notes/{slug}.md."""
    proj = Path(project_path)
    if not _validate_path(proj):
        raise ValueError(f"Path not within projects root: {project_path}")

    notes_dir = proj / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)

    slug = slugify(title)
    slug = resolve_conflict(notes_dir, slug)
    filename = f"{slug}.md"
    file_path = notes_dir / filename

    # Write with title as markdown heading
    file_content = f"# {title}\n\n{content}" if content else f"# {title}\n\n"
    file_path.write_text(file_content)

    logger.info("Created project note: %s", file_path)
    return {"path": str(file_path), "filename": filename}


def rename_file(file_path: str, new_name: str) -> dict:
    """Rename a .md file on disk. new_name can be with or without .md extension."""
    fp = Path(file_path)
    if not _validate_path(fp):
        raise ValueError(f"Path not within projects root: {file_path}")
    if not fp.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    # Ensure .md extension
    if not new_name.endswith(".md"):
        new_name = slugify(new_name) + ".md"

    new_path = fp.parent / new_name
    if new_path == fp:
        return {"old_path": str(fp), "new_path": str(fp), "new_filename": fp.name}

    # Handle conflicts
    if new_path.exists():
        base = new_name.removesuffix(".md")
        resolved = resolve_conflict(fp.parent, base)
        new_path = fp.parent / f"{resolved}.md"

    fp.rename(new_path)
    logger.info("Renamed %s → %s", fp, new_path)
    return {
        "old_path": str(fp),
        "new_path": str(new_path),
        "new_filename": new_path.name,
    }


def delete_file(file_path: str) -> bool:
    """Delete a .md file."""
    fp = Path(file_path)
    if not _validate_path(fp):
        raise ValueError(f"Path not within projects root: {file_path}")
    if not fp.exists():
        return False
    fp.unlink()
    logger.info("Deleted project file: %s", fp)
    return True


def move_global_to_project(note_id: str, target_project_path: str) -> dict:
    """Move a global note to a project's notes/ folder as a plain .md file."""
    # Read global note
    note = notes_manager.get_note(note_id, scope="global")
    if not note:
        raise ValueError(f"Global note not found: {note_id}")

    title = note["title"]
    content = note.get("content", "")

    # Create the .md file in the project
    result = create_note_file(target_project_path, title, content)

    # Delete from global
    notes_manager.delete_note(note_id, scope="global")
    logger.info("Moved global note %s → %s", note_id, result["path"])

    return {
        "target_path": result["path"],
        "target_filename": result["filename"],
        "target_type": "project",
        "title": title,
    }


def move_project_to_global(file_path: str, title: str) -> dict:
    """Move a project .md file to global notes."""
    fp = Path(file_path)
    if not _validate_path(fp):
        raise ValueError(f"Path not within projects root: {file_path}")
    if not fp.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    content = fp.read_text()

    # Strip leading markdown heading if it matches the title
    # (we added "# Title\n\n" when creating, strip it for the note content)
    lines = content.split('\n')
    if lines and lines[0].startswith('# '):
        lines = lines[1:]
        # Also strip the blank line after heading
        if lines and lines[0].strip() == '':
            lines = lines[1:]
    content = '\n'.join(lines)

    # Create global note
    metadata = notes_manager.create_note(title, content, scope="global")

    # Delete original file
    fp.unlink()
    logger.info("Moved project file %s → global note %s", file_path, metadata["id"])

    return {
        "target_id": metadata["id"],
        "target_type": "global",
        "title": title,
    }


def move_between_projects(
    file_path: str,
    target_project_path: str,
    title: str,
) -> dict:
    """Move a .md file from one project's notes/ to another."""
    fp = Path(file_path)
    if not _validate_path(fp):
        raise ValueError(f"Source path not within projects root: {file_path}")

    target = Path(target_project_path)
    if not _validate_path(target):
        raise ValueError(f"Target path not within projects root: {target_project_path}")

    if not fp.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    content = fp.read_text()

    # Create in target project's notes folder
    target_notes_dir = target / "notes"
    target_notes_dir.mkdir(parents=True, exist_ok=True)

    slug = slugify(title)
    slug = resolve_conflict(target_notes_dir, slug)
    filename = f"{slug}.md"
    target_path = target_notes_dir / filename
    target_path.write_text(content)

    # Delete source
    fp.unlink()
    logger.info("Moved %s → %s", file_path, target_path)

    return {
        "target_path": str(target_path),
        "target_filename": filename,
        "target_type": "project",
        "title": title,
    }
