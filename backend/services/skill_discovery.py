"""Skill discovery — scans ~/.claude/skills/ and plugin cache for SKILL.md files."""

import logging
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

# Base directories for skill discovery
CUSTOM_SKILLS_DIR = Path.home() / ".claude" / "skills"
PLUGINS_CACHE_DIR = Path.home() / ".claude" / "plugins" / "cache" / "claude-plugins-official"


def _parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from a SKILL.md file.

    Expects the file to start with '---', followed by YAML, followed by '---'.
    Returns parsed dict or empty dict if no valid frontmatter found.
    """
    content = content.strip()
    if not content.startswith("---"):
        return {}

    # Find the closing --- (skip the opening one)
    end_idx = content.find("---", 3)
    if end_idx == -1:
        return {}

    yaml_str = content[3:end_idx].strip()
    try:
        parsed = yaml.safe_load(yaml_str)
        return parsed if isinstance(parsed, dict) else {}
    except yaml.YAMLError:
        return {}


def _scan_custom_skills() -> list[dict]:
    """Scan ~/.claude/skills/ for custom skill directories."""
    skills = []
    if not CUSTOM_SKILLS_DIR.is_dir():
        return skills

    for skill_dir in sorted(CUSTOM_SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue

        try:
            content = skill_md.read_text(encoding="utf-8")
            meta = _parse_frontmatter(content)
            skills.append({
                "id": skill_dir.name,
                "name": meta.get("name", skill_dir.name),
                "description": meta.get("description", "").strip(),
                "source": "custom",
                "path": str(skill_md),
                "plugin_name": None,
                "readonly": False,
            })
        except Exception as e:
            logger.warning("Failed to read skill %s: %s", skill_dir.name, e)

    return skills


def _scan_plugin_skills() -> list[dict]:
    """Scan ~/.claude/plugins/cache/claude-plugins-official/ for plugin skills.

    Plugin structure: {plugin_name}/{version}/skills/{skill_name}/SKILL.md
    Uses the highest version directory for each plugin.
    """
    skills = []
    if not PLUGINS_CACHE_DIR.is_dir():
        return skills

    for plugin_dir in sorted(PLUGINS_CACHE_DIR.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plugin_name = plugin_dir.name

        # Find the highest version directory that contains a skills/ folder
        version_dirs = []
        for version_dir in plugin_dir.iterdir():
            if version_dir.is_dir() and (version_dir / "skills").is_dir():
                version_dirs.append(version_dir)

        if not version_dirs:
            continue

        # Sort by version string (lexicographic works for semver with same digit count)
        version_dirs.sort(key=lambda d: d.name, reverse=True)
        skills_dir = version_dirs[0] / "skills"

        for skill_dir in sorted(skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.is_file():
                continue

            try:
                content = skill_md.read_text(encoding="utf-8")
                meta = _parse_frontmatter(content)
                skills.append({
                    "id": f"{plugin_name}:{skill_dir.name}",
                    "name": meta.get("name", skill_dir.name),
                    "description": meta.get("description", "").strip(),
                    "source": "plugin",
                    "path": str(skill_md),
                    "plugin_name": plugin_name,
                    "readonly": True,
                })
            except Exception as e:
                logger.warning("Failed to read plugin skill %s/%s: %s", plugin_name, skill_dir.name, e)

    return skills


def list_skills() -> list[dict]:
    """Return all discovered skills (custom + plugin)."""
    return _scan_custom_skills() + _scan_plugin_skills()


def get_skill_content(path: str) -> Optional[dict]:
    """Read full content of a skill file.

    Returns skill metadata + full content, or None if not found.
    """
    file_path = Path(path)
    if not file_path.is_file() or file_path.name != "SKILL.md":
        return None

    # Security: only allow reading from known skill directories
    resolved = file_path.resolve()
    custom_resolved = CUSTOM_SKILLS_DIR.resolve()
    plugins_resolved = PLUGINS_CACHE_DIR.resolve()
    if not (str(resolved).startswith(str(custom_resolved)) or str(resolved).startswith(str(plugins_resolved))):
        return None

    try:
        content = file_path.read_text(encoding="utf-8")
        meta = _parse_frontmatter(content)
        is_plugin = str(resolved).startswith(str(plugins_resolved))
        # Derive plugin_name from path if it's a plugin skill
        plugin_name = None
        if is_plugin:
            # Path: .../plugins/cache/claude-plugins-official/{plugin_name}/{version}/skills/{skill_name}/SKILL.md
            relative = resolved.relative_to(plugins_resolved)
            plugin_name = relative.parts[0] if relative.parts else None

        return {
            "id": meta.get("name", file_path.parent.name),
            "name": meta.get("name", file_path.parent.name),
            "description": meta.get("description", "").strip(),
            "source": "plugin" if is_plugin else "custom",
            "path": str(file_path),
            "plugin_name": plugin_name,
            "readonly": is_plugin,
            "content": content,
        }
    except Exception as e:
        logger.error("Failed to read skill content at %s: %s", path, e)
        return None


def update_skill_content(path: str, content: str) -> Optional[dict]:
    """Write updated content to a skill file.

    Only allows writing to custom skills (not plugin skills).
    Returns updated metadata or None if not found/not writable.
    """
    file_path = Path(path)
    if not file_path.is_file() or file_path.name != "SKILL.md":
        return None

    # Security: only allow writing to custom skills directory
    resolved = file_path.resolve()
    custom_resolved = CUSTOM_SKILLS_DIR.resolve()
    if not str(resolved).startswith(str(custom_resolved)):
        return None  # Plugin skills are read-only

    try:
        file_path.write_text(content, encoding="utf-8")
        meta = _parse_frontmatter(content)
        return {
            "id": file_path.parent.name,
            "name": meta.get("name", file_path.parent.name),
            "description": meta.get("description", "").strip(),
            "source": "custom",
            "path": str(file_path),
            "plugin_name": None,
            "readonly": False,
            "content": content,
        }
    except Exception as e:
        logger.error("Failed to write skill content at %s: %s", path, e)
        return None
