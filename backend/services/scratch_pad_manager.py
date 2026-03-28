"""Scratch pad persistence manager.

Claude writes to .cwb-scratch.md (overwritten each response).
This manager ingests new entries from that file into a persistent
JSON history (.cwb-scratch-history.json), then clears the scratch file.
The frontend reads from the history, not the raw file.
"""

import fcntl
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SCRATCH_FILENAME = ".cwb-scratch.md"
HISTORY_FILENAME = ".cwb-scratch-history.json"
MAX_ENTRIES = 500

# Regex: <cb> with optional attributes, then code content, then </cb>
_CB_REGEX = re.compile(
    r"<cb(?:\s+([^>]*))?>[ \t]*\n?([\s\S]*?)</cb>",
    re.IGNORECASE,
)
# Attribute parsing: key="value"
_ATTR_REGEX = re.compile(r'(\w+)="([^"]*)"')


def _parse_attributes(attr_string: Optional[str]) -> dict[str, str]:
    """Parse HTML-style attributes from a string like 'desc="foo" lang="bash"'."""
    if not attr_string:
        return {}
    return {m.group(1): m.group(2) for m in _ATTR_REGEX.finditer(attr_string)}


def _detect_lang(code: str) -> str:
    """Heuristic language detection for code blocks."""
    stripped = code.strip()
    lines = stripped.split("\n")
    first_line = lines[0].strip() if lines else ""

    # SQL keywords
    sql_keywords = ("SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "CREATE", "DROP", "GRANT")
    if any(stripped.upper().startswith(kw) for kw in sql_keywords):
        return "sql"

    # Python patterns
    if any(l.strip().startswith(("import ", "from ", "def ", "class ")) for l in lines[:5]):
        return "python"

    # JSON — starts with { or [
    if first_line.startswith(("{", "[")):
        try:
            json.loads(stripped)
            return "json"
        except (json.JSONDecodeError, ValueError):
            pass

    # YAML — key: value patterns or starts with ---
    if first_line.startswith("---") or re.match(r"^\w[\w\s]*:", first_line):
        return "yaml"

    # TypeScript/JavaScript patterns
    if any(kw in stripped for kw in ("const ", "let ", "function ", "import {", "export ")):
        return "typescript"

    # HTML
    if stripped.startswith("<") and not stripped.startswith("<cb"):
        return "html"

    # CSS
    if re.search(r"[.#]\w+\s*\{", stripped):
        return "css"

    # Default: bash (most common scratch pad use case)
    return "bash"


def _parse_cb_blocks(content: str) -> list[dict]:
    """Parse <cb> blocks from scratch file content, extracting metadata.

    Handles both old format (<cb> with plain text headers) and
    new format (<cb desc="..." machine="..." lang="...">).
    """
    entries = []
    last_index = 0

    for match in _CB_REGEX.finditer(content):
        attrs = _parse_attributes(match.group(1))
        code = match.group(2).strip()

        if not code:
            last_index = match.end()
            continue

        # Text before this <cb> block — used as fallback description
        preceding_text = content[last_index : match.start()].strip()

        # Determine description: prefer desc attribute, fall back to preceding text
        desc = attrs.get("desc") or preceding_text or None

        # Determine language: prefer lang attribute, fall back to auto-detect
        lang = attrs.get("lang", "").lower() or _detect_lang(code)

        entries.append(
            {
                "desc": desc,
                "machine": attrs.get("machine") or None,
                "lang": lang,
                "code": code,
            }
        )

        last_index = match.end()

    return entries


def _read_history(project_path: str) -> list[dict]:
    """Read the persistent history JSON file."""
    history_path = Path(project_path) / HISTORY_FILENAME
    if not history_path.exists():
        return []
    try:
        data = json.loads(history_path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_history(project_path: str, entries: list[dict]) -> None:
    """Write entries to the persistent history JSON file."""
    history_path = Path(project_path) / HISTORY_FILENAME
    history_path.write_text(json.dumps(entries, indent=2), encoding="utf-8")


def ingest_and_get(project_path: str) -> list[dict]:
    """Read .cwb-scratch.md, ingest new entries into history, clear scratch file, return full history.

    Uses file locking to prevent race conditions when multiple sessions
    poll the same project simultaneously.
    """
    scratch_path = Path(project_path) / SCRATCH_FILENAME
    history = _read_history(project_path)

    # Only ingest if the scratch file exists and has content
    if scratch_path.is_file():
        try:
            # Lock the scratch file to prevent concurrent ingestion
            with open(scratch_path, "r+", encoding="utf-8") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    content = f.read().strip()
                    if content:
                        # Parse new entries
                        new_entries = _parse_cb_blocks(content)
                        now = datetime.now(timezone.utc).isoformat()

                        for entry_data in new_entries:
                            entry = {
                                "id": str(uuid.uuid4())[:8],
                                "desc": entry_data["desc"],
                                "machine": entry_data["machine"],
                                "lang": entry_data["lang"],
                                "code": entry_data["code"],
                                "pinned": False,
                                "created_at": now,
                            }
                            history.append(entry)

                        # Truncate the scratch file after ingestion
                        f.seek(0)
                        f.truncate()

                        # Enforce max entries — prune oldest non-pinned
                        if len(history) > MAX_ENTRIES:
                            pinned = [e for e in history if e.get("pinned")]
                            unpinned = [e for e in history if not e.get("pinned")]
                            # Keep newest unpinned entries to stay under limit
                            keep_count = MAX_ENTRIES - len(pinned)
                            if keep_count > 0:
                                history = pinned + unpinned[-keep_count:]
                            else:
                                history = pinned[:MAX_ENTRIES]

                        _write_history(project_path, history)

                        if new_entries:
                            logger.info(
                                "Ingested %d scratch pad entries for %s",
                                len(new_entries),
                                project_path,
                            )
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except OSError:
            # File may have been deleted between check and open
            pass

    return history


def delete_entry(project_path: str, entry_id: str) -> bool:
    """Delete a single entry by ID from history."""
    history = _read_history(project_path)
    original_len = len(history)
    history = [e for e in history if e["id"] != entry_id]

    if len(history) == original_len:
        return False

    _write_history(project_path, history)
    logger.info("Deleted scratch pad entry %s from %s", entry_id, project_path)
    return True


def update_entry(project_path: str, entry_id: str, pinned: Optional[bool] = None) -> Optional[dict]:
    """Update an entry's metadata (currently just pinned status)."""
    history = _read_history(project_path)
    entry = next((e for e in history if e["id"] == entry_id), None)

    if not entry:
        return None

    if pinned is not None:
        entry["pinned"] = pinned

    _write_history(project_path, history)
    return entry


def clear_all(project_path: str, keep_pinned: bool = True) -> int:
    """Clear all entries. If keep_pinned is True, pinned entries survive.

    Returns the number of entries removed.
    """
    history = _read_history(project_path)
    original_count = len(history)

    if keep_pinned:
        history = [e for e in history if e.get("pinned")]
    else:
        history = []

    _write_history(project_path, history)
    removed = original_count - len(history)
    logger.info("Cleared %d scratch pad entries from %s", removed, project_path)
    return removed
