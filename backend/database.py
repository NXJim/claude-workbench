"""SQLite database setup with async SQLAlchemy."""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import DB_PATH

DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables and seed default data."""
    from models import Session, LayoutPreset, ActiveLayout, ScrollbackEntry, Setting, Snippet, SessionGroup  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Migrate existing tables — add new columns if missing (idempotent)
    async with engine.begin() as conn:
        migrations = [
            "ALTER TABLE layout_presets ADD COLUMN floating_json TEXT",
            "ALTER TABLE layout_presets ADD COLUMN is_workspace INTEGER DEFAULT 0",
            "ALTER TABLE active_layout ADD COLUMN active_workspace_id INTEGER",
            "ALTER TABLE sessions ADD COLUMN workspace_id INTEGER",
        ]
        for sql in migrations:
            try:
                await conn.execute(__import__('sqlalchemy').text(sql))
            except Exception:
                pass  # Column already exists

    # Seed active_layout singleton row if missing
    async with async_session() as db:
        result = await db.execute(
            ActiveLayout.__table__.select().where(ActiveLayout.id == 1)
        )
        if not result.first():
            db.add(ActiveLayout(id=1))
            await db.commit()

    # Adopt orphan sessions — assign workspace_id to sessions that don't have one
    async with async_session() as db:
        from sqlalchemy import select as sa_select

        # Check if any workspace presets exist
        ws_result = await db.execute(
            sa_select(LayoutPreset).where(LayoutPreset.is_workspace == 1)
        )
        workspaces = ws_result.scalars().all()

        # Check for alive orphan sessions (workspace_id IS NULL)
        orphan_result = await db.execute(
            sa_select(Session).where(
                Session.is_alive == 1,
                Session.workspace_id.is_(None),
            )
        )
        orphan_sessions = orphan_result.scalars().all()

        if orphan_sessions:
            if not workspaces:
                # No workspaces exist — create "Default" workspace and assign orphans to it
                default_ws = LayoutPreset(
                    name="Default",
                    layout_json="null",
                    is_workspace=1,
                )
                db.add(default_ws)
                await db.flush()  # Get the ID

                for s in orphan_sessions:
                    s.workspace_id = default_ws.id

                # Set as active workspace
                active_result = await db.execute(
                    sa_select(ActiveLayout).where(ActiveLayout.id == 1)
                )
                active_layout = active_result.scalar_one_or_none()
                if active_layout:
                    active_layout.active_workspace_id = default_ws.id

                await db.commit()
            else:
                # Workspaces exist — assign orphans to the active workspace or first available
                active_result = await db.execute(
                    sa_select(ActiveLayout).where(ActiveLayout.id == 1)
                )
                active_layout = active_result.scalar_one_or_none()
                target_ws_id = (
                    active_layout.active_workspace_id if active_layout and active_layout.active_workspace_id
                    else workspaces[0].id
                )

                for s in orphan_sessions:
                    s.workspace_id = target_ws_id

                await db.commit()

    # Seed default layout presets
    async with async_session() as db:
        from sqlalchemy import select
        result = await db.execute(select(LayoutPreset))
        if not result.scalars().first():
            # Presets use null for empty slots — the frontend substitutes
            # real session IDs when loading, or renders a session picker.
            presets = [
                LayoutPreset(name="Single", layout_json='null', is_default=1),
                LayoutPreset(name="2-Up", layout_json='{"direction":"row","first":null,"second":null,"splitPercentage":50}', is_default=0),
                LayoutPreset(name="2+1", layout_json='{"direction":"row","first":{"direction":"column","first":null,"second":null,"splitPercentage":50},"second":null,"splitPercentage":66}', is_default=0),
                LayoutPreset(name="3-Column", layout_json='{"direction":"row","first":null,"second":{"direction":"row","first":null,"second":null,"splitPercentage":50},"splitPercentage":33}', is_default=0),
                LayoutPreset(name="4-Way", layout_json='{"direction":"row","first":{"direction":"column","first":null,"second":null,"splitPercentage":50},"second":{"direction":"column","first":null,"second":null,"splitPercentage":50},"splitPercentage":50}', is_default=0),
            ]
            db.add_all(presets)
            await db.commit()


async def get_db():
    """Dependency injection for async DB session."""
    async with async_session() as session:
        yield session
