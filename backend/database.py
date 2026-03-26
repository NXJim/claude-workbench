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
            "ALTER TABLE layout_presets ADD COLUMN sort_order INTEGER DEFAULT 0",
            "ALTER TABLE layout_presets ADD COLUMN color TEXT",
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

    # NOTE: Sessions with workspace_id=NULL are intentionally left unassigned.
    # They appear in the frontend "Orphaned" tab and can be manually moved
    # to a workspace by the user. Do NOT auto-assign them here.

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
