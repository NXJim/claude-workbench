"""Pydantic schemas for API request/response validation."""

import json
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


# --- Sessions ---

class SessionCreate(BaseModel):
    project_path: Optional[str] = None
    display_name: Optional[str] = None
    color: Optional[str] = "#7aa2f7"
    workspace_id: Optional[int] = None
    skip_claude_prompt: bool = False


class SessionUpdate(BaseModel):
    display_name: Optional[str] = None
    color: Optional[str] = None
    notes: Optional[str] = None
    workspace_id: Optional[int] = None


class SessionResponse(BaseModel):
    id: str
    tmux_name: str
    project_path: Optional[str]
    display_name: Optional[str]
    color: str
    status: str
    notes: str
    created_at: datetime
    last_activity_at: datetime
    is_alive: bool
    workspace_id: Optional[int] = None

    class Config:
        from_attributes = True


class SessionNotesUpdate(BaseModel):
    notes: str


# --- Projects ---

class ProjectInfo(BaseModel):
    name: str
    path: str
    type: str  # web, apps, tools, data
    session_count: int = 0
    has_claude_md: bool = False
    dev_ports: dict = {"backend": None, "frontend": None}
    health_endpoint: Optional[str] = None
    health_status: Optional[dict] = None
    git_info: Optional[dict] = None
    display_name: Optional[str] = None
    md_files: list[str] = []


# --- Layouts ---

class LayoutPresetCreate(BaseModel):
    name: str
    layout_json: str
    floating_json: Optional[str] = None
    is_workspace: bool = False


class LayoutPresetUpdate(BaseModel):
    name: Optional[str] = None
    layout_json: Optional[str] = None
    floating_json: Optional[str] = None
    color: Optional[str] = None


class LayoutPresetResponse(BaseModel):
    id: int
    name: str
    layout_json: str
    floating_json: Optional[str] = None
    is_default: bool
    is_workspace: bool = False
    sort_order: int = 0
    color: Optional[str] = None

    class Config:
        from_attributes = True

    @field_validator("is_workspace", mode="before")
    @classmethod
    def parse_is_workspace(cls, v):
        """SQLite stores as int, convert to bool."""
        if isinstance(v, int):
            return bool(v)
        return v


class ActiveLayoutUpdate(BaseModel):
    tiling_json: Optional[str] = None
    floating_json: Optional[str] = None
    sidebar_collapsed: Optional[bool] = None
    sidebar_width: Optional[int] = None
    sidebar_section_ratios: Optional[list[float]] = None
    active_workspace_id: Optional[int] = None


class ActiveLayoutResponse(BaseModel):
    tiling_json: Optional[str]
    floating_json: Optional[str]
    sidebar_collapsed: bool
    sidebar_width: int
    sidebar_section_ratios: Optional[list[float]] = None
    active_workspace_id: Optional[int] = None

    class Config:
        from_attributes = True

    @field_validator("sidebar_section_ratios", mode="before")
    @classmethod
    def parse_ratios(cls, v):
        """Deserialize JSON string from SQLite column to list."""
        if isinstance(v, str):
            return json.loads(v)
        return v


# --- Search ---

class SearchResult(BaseModel):
    session_id: str
    session_name: Optional[str]
    session_color: str
    lines: list[str]
    captured_at: datetime


# --- Notes ---

class NoteMetadata(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    pinned: bool = False


class NoteCreate(BaseModel):
    title: str
    content: str = ""
    scope: str = "global"  # "global" or "project"
    project_path: Optional[str] = None


class NoteUpdate(BaseModel):
    content: str


class NoteMetadataUpdate(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None


# --- CLAUDE.md ---

class ClaudeMdFile(BaseModel):
    path: str
    label: str
    category: str  # "global", "global-rules", "project"
    project_name: Optional[str] = None


class ClaudeMdContent(BaseModel):
    path: str
    content: str


class ClaudeMdWrite(BaseModel):
    path: str
    content: str


# --- Snippets ---

class SnippetCreate(BaseModel):
    title: str
    description: str = ""
    language: str = "text"
    code: str
    tags: str = ""
    source_project: Optional[str] = None


class SnippetUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    language: Optional[str] = None
    code: Optional[str] = None
    tags: Optional[str] = None
    source_project: Optional[str] = None


class SnippetResponse(BaseModel):
    id: str
    title: str
    description: str
    language: str
    code: str
    tags: str
    source_project: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Session Groups ---

class SessionGroupCreate(BaseModel):
    name: str
    project_path: Optional[str] = None
    session_configs: list[dict] = []  # [{ display_name, project_path, color }]


class SessionGroupUpdate(BaseModel):
    name: Optional[str] = None
    project_path: Optional[str] = None
    session_configs: Optional[list[dict]] = None


class SessionGroupResponse(BaseModel):
    id: str
    name: str
    project_path: Optional[str]
    session_configs: list[dict]
    created_at: datetime

    class Config:
        from_attributes = True

    @field_validator("session_configs", mode="before")
    @classmethod
    def parse_configs(cls, v):
        """Deserialize JSON string from SQLite column to list."""
        if isinstance(v, str):
            return json.loads(v)
        return v


# --- Project Files (plain .md in project/notes/) ---

class ProjectFileCreate(BaseModel):
    project_path: str
    title: str
    content: str = ""


class ProjectFileRename(BaseModel):
    file_path: str
    new_name: str


class NoteMoveRequest(BaseModel):
    source_type: str  # "global" or "project"
    source_id: Optional[str] = None  # for global notes
    source_path: Optional[str] = None  # for project .md files
    target_type: str  # "global" or "project"
    target_project_path: Optional[str] = None  # required when target_type == "project"
    title: str


# --- Clipboard ---

class ClipboardContent(BaseModel):
    content: str
