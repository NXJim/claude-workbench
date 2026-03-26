"""SQLAlchemy ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Integer, DateTime, CheckConstraint
from sqlalchemy.sql import func

from database import Base


def generate_id():
    return str(uuid.uuid4())[:8]


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=generate_id)
    tmux_name = Column(String, nullable=False, unique=True)
    project_path = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    color = Column(String, default="#7aa2f7")
    status = Column(String, default="idle")  # connected/busy/idle/disconnected
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=func.now())
    last_activity_at = Column(DateTime, default=func.now(), onupdate=func.now())
    is_alive = Column(Integer, default=1)
    workspace_id = Column(Integer, nullable=True)  # FK to LayoutPreset.id (workspace)


class LayoutPreset(Base):
    __tablename__ = "layout_presets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)
    layout_json = Column(Text, nullable=False)
    floating_json = Column(Text, nullable=True)
    is_default = Column(Integer, default=0)
    is_workspace = Column(Integer, default=0)  # 0=template preset, 1=workspace
    sort_order = Column(Integer, default=0)  # Display order for workspace tabs (lower first)
    color = Column(String, nullable=True)  # Tab accent color (hex, e.g. "#3b82f6")


class ActiveLayout(Base):
    __tablename__ = "active_layout"

    id = Column(Integer, primary_key=True)
    tiling_json = Column(Text, nullable=True)
    floating_json = Column(Text, nullable=True)
    sidebar_collapsed = Column(Integer, default=0)
    sidebar_width = Column(Integer, default=280)
    sidebar_section_ratios = Column(Text, nullable=True)  # JSON: [0.5, 0.3, 0.2]
    active_workspace_id = Column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
    )


class Setting(Base):
    """Key-value settings store."""
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)


class Snippet(Base):
    """Code snippet for the knowledge base."""
    __tablename__ = "snippets"

    id = Column(String, primary_key=True, default=generate_id)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    language = Column(String, default="text")
    code = Column(Text, nullable=False)
    tags = Column(Text, default="")  # comma-separated
    source_project = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class SessionGroup(Base):
    """Named group of session configurations for batch launch."""
    __tablename__ = "session_groups"

    id = Column(String, primary_key=True, default=generate_id)
    name = Column(String, nullable=False)
    project_path = Column(String, nullable=True)
    session_configs = Column(Text, default="[]")  # JSON: [{ display_name, project_path, color }]
    created_at = Column(DateTime, default=func.now())


class ScrollbackEntry(Base):
    """Regular table for scrollback search — we'll use LIKE queries instead of FTS5
    since aiosqlite + FTS5 virtual tables can be tricky with SQLAlchemy ORM."""
    __tablename__ = "scrollback_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=False)
    captured_at = Column(DateTime, default=func.now())
