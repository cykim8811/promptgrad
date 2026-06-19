"""First-sight user upsert + /api/me.

The platform doesn't pre-create a row in the tenant DB. We do it lazily
on first sight, keyed on `coders_id` (the platform identity).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.identity import require_identity
from app.models import User

router = APIRouter(prefix="/api", tags=["users"])


async def upsert_local_user(session: AsyncSession, coders_id: UUID) -> User:
    """Insert-on-first-sight; otherwise just bump last_seen_at."""
    default_name = f"user-{str(coders_id)[:8]}"
    await session.execute(
        pg_insert(User)
        .values(coders_id=coders_id, display_name=default_name)
        .on_conflict_do_nothing(index_elements=["coders_id"])
    )
    res = await session.execute(select(User).where(User.coders_id == coders_id))
    user = res.scalar_one()
    # Touch last_seen_at (the onupdate trigger fires when we modify anything).
    user.display_name = user.display_name
    return user


@router.get("/me")
async def me(
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return the signed-in visitor's app-local user row.

    Anonymous → 401 (`require_identity`). Anyone who got here has a
    valid coders.kr session.
    """
    user = await upsert_local_user(session, coders_id)
    return {
        "id": str(user.id),
        "coders_id": str(user.coders_id),
        "display_name": user.display_name,
        "first_seen_at": user.first_seen_at.isoformat(),
    }
